import _ from 'lodash'
import logger from '@overleaf/logger'
import { Readable } from 'stream'
import settings from '@overleaf/settings'
import { OError } from '../../../../app/src/Features/Errors/Errors.js'
import { Template } from './models/Template.mjs'
import {
  validateTemplateInput,
  renderTemplateHtmlFields,
  uploadTemplateAssets,
  deleteTemplateAssets,
  canUserOverrideTemplate,
  generateTemplateData
} from './TemplateGalleryHelper.mjs'
import { cleanHtml }  from './CleanHtml.mjs'
import { TemplateNameConflictError } from './TemplateErrors.mjs'
import { fetchStreamWithResponse } from '@overleaf/fetch-utils'
import ProjectGetter from '../../../../app/src/Features/Project/ProjectGetter.mjs'
const TIMEOUT = 30000

async function editTemplate({ templateId, updates }) {

  validateTemplateInput(updates)

  const template = await Template.findById(templateId)
  if (!template) {
    throw new OError('Current template not found, strange...', { status: 500, templateId })
  }

  if (updates.name) {
    const conflictingTemplate = await Template.findOne(
      { name: updates.name, _id: { $ne: templateId } },
      { owner: true }
    ).exec()
    if (conflictingTemplate) {
      throw new TemplateNameConflictError(String(conflictingTemplate.owner))
    }
  }

  await renderTemplateHtmlFields(updates)
  updates.lastUpdated = new Date()
  Object.assign(template, updates)

  await template.save()

  return updates
}

async function deleteTemplate({ templateId, version }) {
  await deleteTemplateAssets(templateId, version, true)
}

async function createTemplateFromProject({ projectId, userId, templateSource }) {
  validateTemplateInput(templateSource)
  let template = await Template.findOne({ name: templateSource.name }).exec()

  if (template && !templateSource.override) {
    const { canOverride, templateOwnerName } = await canUserOverrideTemplate(template, userId)

    return {
      conflict: true,
      canOverride,
      templateOwnerName
    }
  }

  const templateData = await generateTemplateData(projectId, templateSource)

  let previousVersionExists
  if (!template) {
    template = new Template(templateData)
    template.owner = userId
    previousVersionExists = false
  } else {
    Object.assign(template, templateData, {
      version: template.version + 1,
    })
    previousVersionExists = true
  }

  // We should alwary update project_id to make sure it is correct
  // Some times, admin may publish another project as template with 
  // the same name, if override, project_id may be changed to the new one
  template.project_id = projectId

  await uploadTemplateAssets(projectId, userId, templateSource.build, template)
  await template.save()

  if (previousVersionExists) {
    deleteTemplateAssets(template._id, template.version - 1, false)
  }
  return {
    conflict: false,
    templateId: template._id,
    version: template.version,
  }
}

async function fetchTemplatePreview({ templateId, version, style }) {
  if (!templateId || !version) {
    throw new OError('Template ID and version are required', { status: 404 })
  }
  const styleParam = style ? `style=${style}` : ''
  const isImage = (style === 'preview' || style === 'thumbnail')

  if (style && !isImage) {
    throw new OError('Wrong style', { status: 404, style })
  }

  const pdfUrl = `${settings.apis.filestore.url}/template/${templateId}/v/${version}/pdf?${styleParam}`
  const { response } = await fetchStreamWithResponse(pdfUrl, {
    method: 'GET',
    signal: AbortSignal.timeout(TIMEOUT),
  })

  if (!response.ok) {
    throw new OError(`Failed to fetch file: ${response.statusText}`, { status: 400, templateId, version, styleParam })
  }

  return {
    stream: Readable.from(response.body),
    contentType: isImage ? 'application/octet-stream' : 'application/pdf'
  }
}


async function fetchTemplateZip({ templateId, version }) {
  if (!templateId || !version) {
    throw new OError('Template ID and version are required', { status: 404 })
  }

  const zipUrl = `${settings.apis.filestore.url}/template/${templateId}/v/${version}/zip`
  const { response } = await fetchStreamWithResponse(zipUrl, {
    method: 'GET',
    signal: AbortSignal.timeout(TIMEOUT),
  })

  if (!response.ok) {
    throw new OError(`Failed to fetch file: ${response.statusText}`, { status: 400, templateId, version })
  }

  return {
    stream: Readable.from(response.body),
    contentType: 'application/zip',
    filename: `template_${templateId}_v${version}.zip`
  }
}

async function getTemplatesPageData(category) {
  const categoryName = settings.templateLinks.find(item => item.url.endsWith(`/${category}`))?.name
  const templateLinks = categoryName ? undefined : settings.templateLinks.filter(link => link.url !== '/templates/all')
  return {
    categoryName,
    templateLinks
  }
}

async function getTemplate(key, val) {
  if (!key || !val) {
    logger.warn('No key or val provided to getTemplate')
    return null
  }

  const query = { [key]: val }
  const template = await Template.findOne(query).exec()
  if (!template) return null

  // Check if associated project still exists, if not, 
  // set project_id to null to avoid showing wrong project link on template details page
  if (template.project_id) {
    const projectExists = await ProjectGetter.promises.getProject(template.project_id, { _id: 1 })
    if (!projectExists) {
      template.project_id = null
    }
  }

  return _formatTemplateForPage(template)
}

const MAX_PAGE_SIZE = 50
// Name sorting is case-insensitive. Any index on `name` must be created with
// this same collation, otherwise mongo cannot use it and sorts in memory.
const NAME_COLLATION = { locale: 'en', strength: 2 }

async function getCategoryTemplates(reqQuery) {
  const {
    category,
    by = 'lastUpdated',
    order = 'desc',
    page = '1',
    pageSize = '9',
    q = '',
  } = reqQuery || {}

  if (!['lastUpdated', 'name'].includes(by) || !['asc', 'desc'].includes(order)) {
    throw new OError('Invalid sorting criteria', { status: 400, sort: { by, order } })
  }
  const pageNumber = Math.max(parseInt(page, 10) || 1, 1)
  const size = Math.min(Math.max(parseInt(pageSize, 10) || 9, 1), MAX_PAGE_SIZE)

  const query = (category === 'all') ? {} : { category : '/templates/' + category }
  if (q) {
    // Search the markdown sources: the rendered name/author/description
    // fields contain HTML markup that plain text queries would match.
    const search = { $regex: _.escapeRegExp(q), $options: 'i' }
    query.$or = [{ name: search }, { authorMD: search }, { descriptionMD: search }]
  }

  // _id tiebreaker keeps page boundaries stable when templates share a sort value
  const direction = order === 'asc' ? 1 : -1
  const sortSpec = { [by]: direction, _id: direction }

  const projection = { _id : 1, version : 1, name : 1, author : 1, description : 1, lastUpdated : 1 }
  let templatesQuery = Template.find(query, projection)
    .sort(sortSpec)
    .skip((pageNumber - 1) * size)
    .limit(size)
  if (by === 'name') {
    templatesQuery = templatesQuery.collation(NAME_COLLATION)
  }

  const [totalSize, templates] = await Promise.all([
    Template.countDocuments(query),
    templatesQuery.exec(),
  ])

  return {
    totalSize,
    templates: templates.map(_formatTemplateForList),
  }
}

function _formatTemplateForList(template) {
  return {
    id: String(template._id),
    version: String(template.version),
    name: template.name,
    author: cleanHtml(template.author, "plainText"),
    description: cleanHtml(template.description, "plainText"),
    lastUpdated: template.lastUpdated,
  }
}

// imageName: quay.io/sharelatex/texlive-full:2024.1
function _formatImageNameForPage(imageName) {
  if (!imageName) return imageName
  return imageName.split("/")[imageName.split("/").length - 1]
}

function _formatTemplateForPage(template) {
  return {
    id: template._id.toString(),
    version: template.version.toString(),
    category: template.category,
    name: template.name,
    author: cleanHtml(template.author, "linksOnly"),
    authorMD: template.authorMD,
    description: cleanHtml(template.description, "reachText"),
    descriptionMD: template.descriptionMD,
    license: template.license,
    lastUpdated: template.lastUpdated,
    owner: template.owner,
    mainFile: template.mainFile,
    compiler: template.compiler,
    imageName: _formatImageNameForPage(template.imageName),
    language: template.language,
    project_id: template.project_id?.toString() || null
  }
}

export default {
  createTemplateFromProject,
  editTemplate,
  deleteTemplate,
  getTemplate,
  getCategoryTemplates,
  fetchTemplatePreview,
  fetchTemplateZip,
  getTemplatesPageData,
}
