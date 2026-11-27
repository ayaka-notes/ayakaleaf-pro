// @ts-check
// Typst project creation (POST /project/new/typst).
//
// Attribution: Typst support is built on contributions from:
//   - kxxt/overleaf (typst branch): https://github.com/kxxt/overleaf/tree/typst
//   - texlyre (@fabawi): https://github.com/texlyre/texlyre
//   - typst/typst fork 0.15.1-with-extras @ d101c2f5
//
// Ported from the OlliTeX Go port (`go/services/web/features/projectlist/
// create_typst.go`, Node-oracle P6.16). Creates a project whose `compiler` is
// "typst" (so it routes to services/clsi-typst) and seeds one of three
// dependency-free Typst templates:
//
//   template  docs                     file
//   basic     main.typ                 —
//   article   main.typ, references.bib —
//   example   main.typ, sample.bib     frog.jpg
//
// Template docs carry a `<%= project_name %>` tag that is substituted with the
// (trimmed) project name — plain lodash interpolation, NOT HTML-escaped
// (lodash `.template` does not escape interpolations), matching the Go port
// and the live TeX `_buildTemplate` behaviour.

import fs from 'node:fs'
import Path from 'node:path'
import _ from 'lodash'

import logger from '@overleaf/logger'
import { parseReq, z } from '../../../../app/src/infrastructure/Validation.mjs'
import SessionManager from '../../../../app/src/Features/Authentication/SessionManager.mjs'
import ProjectCreationHandler from '../../../../app/src/Features/Project/ProjectCreationHandler.mjs'
import ProjectDetailsHandler from '../../../../app/src/Features/Project/ProjectDetailsHandler.mjs'
import ProjectEntityUpdateHandler from '../../../../app/src/Features/Project/ProjectEntityUpdateHandler.mjs'
import ProjectAuditLogHandler from '../../../../app/src/Features/Project/ProjectAuditLogHandler.mjs'

const TEMPLATES = ['basic', 'article', 'example']

// NON-strict schema (unlike the TeX /project/new strictObject): both fields
// optional, bounded; unknown keys are stripped by z.object.
const newTypstProjectSchema = z.object({
  body: z.object({
    projectName: z
      .string()
      .trim()
      .max(100)
      .optional()
      .transform(v => (v === '' ? undefined : v)),
    template: z.string().max(50).optional(),
  }),
})

function templateDir() {
  // This file is at modules/typst/app/src/; templates live one level up in
  // modules/typst/app/templates/project_files (mirrors the TeX module layout).
  return Path.join(import.meta.dirname, '../templates/project_files')
}

// Read a template file and apply lodash's plain `<%= project_name %>`
// substitution, returning the split lines (Node `.split('\n')` semantics).
function buildTemplateFileLines(name, rel) {
  let raw
  try {
    raw = fs.readFileSync(Path.join(templateDir(), rel), 'utf8')
  } catch (err) {
    logger.error({ err, rel }, 'failed to read typst template')
    return []
  }
  const output = _.template(raw)({ project_name: name || 'My project' })
  return output.split('\n')
}

// Add `name` as a doc in the root folder and (when isRoot) set it as the root
// doc. Returns the created doc.
async function addTypstDoc(project, ownerId, name, docLines, isRoot) {
  const { doc } = await ProjectEntityUpdateHandler.promises.addDoc(
    project._id,
    project.rootFolder[0]._id,
    name,
    docLines,
    ownerId,
    null
  )
  if (isRoot) {
    await ProjectEntityUpdateHandler.promises.setRootDoc(project._id, doc._id)
    project.rootDoc_id = doc._id
  }
  return doc
}

async function seedTemplate(project, ownerId, template, projectName) {
  const dir = templateDir()
  switch (template) {
    case 'article': {
      await addTypstDoc(
        project,
        ownerId,
        'main.typ',
        buildTemplateFileLines(projectName, 'article/main.typ'),
        true
      )
      await addTypstDoc(
        project,
        ownerId,
        'references.bib',
        buildTemplateFileLines(projectName, 'article/references.bib'),
        false
      )
      break
    }
    case 'example': {
      await addTypstDoc(
        project,
        ownerId,
        'main.typ',
        buildTemplateFileLines(projectName, 'example/main.typ'),
        true
      )
      await addTypstDoc(
        project,
        ownerId,
        'sample.bib',
        buildTemplateFileLines(projectName, 'example/sample.bib'),
        false
      )
      const frogPath = Path.join(dir, 'example/frog.jpg')
      if (fs.existsSync(frogPath)) {
        await ProjectEntityUpdateHandler.promises.addFile(
          project._id,
          project.rootFolder[0]._id,
          'frog.jpg',
          frogPath,
          null,
          ownerId,
          null
        )
      }
      break
    }
    case 'basic':
    default: {
      await addTypstDoc(
        project,
        ownerId,
        'main.typ',
        buildTemplateFileLines(projectName, 'mainbasic.typ'),
        true
      )
      break
    }
  }
}

/**
 * POST /project/new/typst
 * Body: { projectName?: string, template?: 'basic'|'article'|'example' }
 * 200:  { project_id, owner_ref, owner: {first_name,last_name,email,_id} }
 */
export default {
  async newTypstProject(req, res) {
    const currentUser = SessionManager.getSessionUser(req.session)
    const {
      first_name: firstName,
      last_name: lastName,
      email,
      _id: userId,
    } = currentUser

    const { body } = parseReq(req, newTypstProjectSchema, { logOnly: true })
    const projectName =
      body.projectName != null ? body.projectName.trim() : undefined
    const template = TEMPLATES.includes(body.template)
      ? body.template
      : 'basic'

    // validateProjectName throws InvalidNameError → 400 plain text (blank,
    // too long, contains / or \, untrimmed) — same as the TeX /project/new.
    await ProjectDetailsHandler.promises.validateProjectName(projectName)

    const project = await ProjectCreationHandler.promises.createBlankProject(
      userId,
      projectName,
      { compiler: 'typst' }
    )

    await seedTemplate(project, userId, template, projectName)

    ProjectAuditLogHandler.addEntryIfManagedInBackground(
      project._id,
      'project-created',
      project.owner_ref,
      req.ip
    )

    res.json({
      project_id: project._id,
      owner_ref: project.owner_ref,
      owner: {
        first_name: firstName,
        last_name: lastName,
        email,
        _id: userId,
      },
    })
  },
}
