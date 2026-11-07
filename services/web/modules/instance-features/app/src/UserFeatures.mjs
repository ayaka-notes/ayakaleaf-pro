import { expressify } from '@overleaf/promise-utils'
import { ObjectId } from '../../../../app/src/infrastructure/mongodb.mjs'
import SessionManager from '../../../../app/src/Features/Authentication/SessionManager.mjs'
import HttpErrorHandler from '../../../../app/src/Features/Errors/HttpErrorHandler.mjs'
import ProjectGetter from '../../../../app/src/Features/Project/ProjectGetter.mjs'
import UserGetter from '../../../../app/src/Features/User/UserGetter.mjs'

// The per-user switches of the admin panel, saved in user.features. A user has
// a feature unless an admin turned it off: the defaults leave some of them
// unset (github, gitBridge, zotero, mendeley), which counts as on, as in the
// panel. Whether the instance has the feature at all is /system/features' part.

export function isFeatureOn(user, feature) {
  return user?.features?.[feature] !== false
}

export async function userHasFeature(userId, feature) {
  const user = await UserGetter.promises.getUser(userId, { features: 1 })
  return isFeatureOn(user, feature)
}

// For the features that follow the project's owner, as core's do. Also called
// before core's routes check anything: a project that does not exist is theirs
// to answer.
export async function projectOwnerHasFeature(projectId, feature) {
  if (!ObjectId.isValid(projectId)) return true
  const project = await ProjectGetter.promises.getProject(projectId, {
    owner_ref: 1,
  })
  return !project || (await userHasFeature(project.owner_ref, feature))
}

// Core registers most of its project routes before the modules' (router.mjs),
// so a module's route on the same path would run after core has answered. A
// param callback runs before the handlers of any route with that parameter,
// wherever it was registered, once the session is there: `routes`, a router of
// its own with core's paths, goes first that way.
export function runBeforeCoreRoutes(webRouter, routes) {
  for (const param of ['Project_id', 'project_id']) {
    webRouter.param(param, (req, res, next) => routes(req, res, next))
  }
}

// After the route's login check: the session's user, or the token's
export function requireUserFeature(feature) {
  return expressify(async (req, res, next) => {
    const userId =
      req.oauth_user?._id ?? SessionManager.getLoggedInUserId(req.session)
    if (await userHasFeature(userId, feature)) return next()
    HttpErrorHandler.forbidden(req, res)
  })
}
