import { expressify } from '@overleaf/promise-utils'
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

// For the features that follow the project's owner, as core's do
export async function projectOwnerHasFeature(projectId, feature) {
  const project = await ProjectGetter.promises.getProject(projectId, {
    owner_ref: 1,
  })
  return await userHasFeature(project.owner_ref, feature)
}

// After the route's login check: the session's user, or the token's
export function requireUserFeature(feature) {
  return expressify(async (req, res, next) => {
    const userId =
      req.oauth_user?._id ?? SessionManager.getLoggedInUserId(req.session)
    if (await userHasFeature(userId, feature)) return next()
    // Token routes are not on the web router: its error page could not render
    if (req.oauth_user) return res.status(403).json({ message: 'restricted' })
    HttpErrorHandler.forbidden(req, res)
  })
}
