import TemplatesManager from './TemplatesManager.mjs'
import SessionManager from '../../../../app/src/Features/Authentication/SessionManager.mjs' 
import path from 'node:path'

// Return a page to create a project from a template
async function getProjectFromTemplate(req, res, next) {
  const templateId = req.query.id
  const templateVersionId = req.query.version
  const data = {
    templateVersionId,
    templateId,
    name: req.query.name,
    compiler: req.query.compiler,
    language: req.query.language,
    imageName: req.query.imageName,
    mainFile: req.query.mainFile,
    brandVariationId: req.query.brandVariationId,
  }
  res.render(
    path.resolve(
      import.meta.dirname,
      '../views/new_from_template'
    ),
    data
  )
}

// The page returned in GET will launch a POST 
// request to this function to actually create the project
async function createProjectFromTemplate(req, res, next) {
  const userId = SessionManager.getLoggedInUserId(req.session)
  // the route is not wrapped in expressify, so an error here must reach next():
  // an unhandled rejection exits the web process
  let project
  try {
    project = await TemplatesManager.promises.createProjectFromV1Template(
      req.body.brandVariationId,
      req.body.compiler,
      req.body.mainFile,
      req.body.templateId,
      req.body.templateName,
      req.body.templateVersionId,
      userId,
      req.body.imageName,
      req.body.language
    )
  } catch (error) {
    return next(error)
  }
    delete req.session.templateData
    if (!project) {
      return next(new Error('failed to create project from template'))
    }
    return res.redirect(`/project/${project._id}`)
}

export default {
  getProjectFromTemplate,
  createProjectFromTemplate
}