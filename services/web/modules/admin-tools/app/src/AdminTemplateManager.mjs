import Errors from '../../../../app/src/Features/Errors/Errors.js'
import { Template } from '../../../template-gallery/app/src/models/Template.mjs'
import { cleanHtml } from '../../../template-gallery/app/src/CleanHtml.mjs'
import TemplateGalleryManager from '../../../template-gallery/app/src/TemplateGalleryManager.mjs'
import { logOnAdmin } from './AdminAuditLog.mjs'
import {
  containing,
  findPage,
  parseOrder,
  parsePaging,
  sortBy,
} from './AdminQueryHelper.mjs'
import AdminUserListManager from './AdminUserListManager.mjs'

// The templates of the gallery, for the Templates tab of /admin/project.

function parseTemplatesQuery(query) {
  const sort = query.sort === 'name' ? 'name' : 'lastUpdated'
  return {
    ...parsePaging(query),
    sort,
    order: parseOrder(query, sort === 'name' ? 'asc' : 'desc'),
  }
}

// The gallery's /api/templates tells no owners and stops at 50 a page
async function getTemplateList(rawQuery) {
  const query = parseTemplatesQuery(rawQuery)
  // the gallery's search: the markdown sources, the rendered fields hold HTML
  const regex = containing(query.search)
  const match = query.search
    ? { $or: [{ name: regex }, { authorMD: regex }, { descriptionMD: regex }] }
    : {}
  const { rows, total, page } = await findPage(
    Template,
    match,
    '_id name author owner lastUpdated',
    sortBy([query.sort], query.order),
    query
  )
  const owner = await AdminUserListManager.ownersOf(rows.map(row => row.owner))
  return {
    total,
    page,
    query: { ...query, page },
    templates: rows.map(template => ({
      id: template._id.toString(),
      name: template.name,
      author: cleanHtml(template.author, 'plainText'),
      owner: owner(template.owner),
      lastUpdated: template.lastUpdated,
    })),
  }
}

// The gallery's delete, with its version looked up
async function deleteTemplate(templateId, admin) {
  const template = await Template.findById(templateId, {
    name: 1,
    version: 1,
  }).lean()
  if (!template) throw new Errors.NotFoundError('template not found')
  await TemplateGalleryManager.deleteTemplate({
    templateId: templateId.toString(),
    version: template.version,
  })
  await logOnAdmin(admin, 'delete-template', {
    templateId,
    name: template.name,
  })
}

export default {
  getTemplateList,
  deleteTemplate,
}
