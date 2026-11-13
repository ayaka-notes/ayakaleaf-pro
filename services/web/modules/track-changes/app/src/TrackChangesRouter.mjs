import logger from '@overleaf/logger'
import { expressify } from '@overleaf/promise-utils'
import HttpErrorHandler from '../../../../app/src/Features/Errors/HttpErrorHandler.mjs'
import AuthorizationMiddleware from '../../../../app/src/Features/Authorization/AuthorizationMiddleware.mjs'
import ProjectHelper from '../../../../app/src/Features/Project/ProjectHelper.mjs'
import { Project } from '../../../../app/src/models/Project.mjs'
import { parseReq, z } from '../../../../app/src/infrastructure/Validation.mjs'
import { projectOwnerHasFeature } from '../../../instance-features/app/src/UserFeatures.mjs'
import TrackChangesController from './TrackChangesController.mjs'

// Without the owner's feature a project cannot turn tracking on. All it already
// has stays usable, as in core, whose editor reads the same feature: comments,
// changes, and reviewers, who can be invited and are comment only.
const refuseTrackingWithoutFeature = expressify(async (req, res, next) => {
  if (
    !(await turnsTrackingOn(req)) ||
    (await projectOwnerHasFeature(req.params.project_id, 'trackChanges'))
  ) {
    return next()
  }
  HttpErrorHandler.forbidden(req, res)
})

// Turning tracking on for anyone it is off for now. The editor sends every
// member's value, so the ones already on are not new; turning off stays open.
async function turnsTrackingOn(req) {
  const { on_for: onFor = {}, on_for_guests: onForGuests } = req.body
  const project = await Project.findById(req.params.project_id, {
    track_changes: 1,
  }).lean()
  const isOn = key =>
    ProjectHelper.isTrackChangesEnabledForUser(project?.track_changes, key)
  return (
    Object.entries(onFor).some(
      ([userId, on]) => on === true && !isOn(userId)
    ) ||
    (onForGuests === true && !isOn('__guests__'))
  )
}

// What the editor sends (track-changes-state-context.tsx): on or off per
// member, or for guests. Anything else is refused (400) before the check above
// and the controller, which stores the values as they come
const trackChangesSchema = z.object({
  body: z.object({
    on_for: z.record(z.string(), z.boolean()).optional(),
    on_for_guests: z.boolean().optional(),
  }),
})

function validateTrackChanges(req, res, next) {
  parseReq(req, trackChangesSchema)
  next()
}

export default {
  apply(webRouter) {
    logger.debug({}, 'Init track-changes router')

    webRouter.post(
      '/project/:project_id/track_changes',
      AuthorizationMiddleware.blockRestrictedUserFromProject,
      AuthorizationMiddleware.ensureUserCanWriteProjectContent,
      validateTrackChanges,
      refuseTrackingWithoutFeature,
      TrackChangesController.trackChanges
    )
    webRouter.post(
      '/project/:project_id/doc/:doc_id/changes/accept',
      AuthorizationMiddleware.blockRestrictedUserFromProject,
      AuthorizationMiddleware.ensureUserCanWriteProjectContent,
      TrackChangesController.acceptChanges
    )
    webRouter.get(
      '/project/:project_id/ranges',
      AuthorizationMiddleware.blockRestrictedUserFromProject,
      AuthorizationMiddleware.ensureUserCanReadProject,
      TrackChangesController.getAllRanges
    )
    webRouter.get(
      '/project/:project_id/changes/users',
      AuthorizationMiddleware.blockRestrictedUserFromProject,
      AuthorizationMiddleware.ensureUserCanReadProject,
      TrackChangesController.getChangesUsers
    )
    webRouter.get(
      '/project/:project_id/threads',
      AuthorizationMiddleware.blockRestrictedUserFromProject,
      AuthorizationMiddleware.ensureUserCanReadProject,
      TrackChangesController.getThreads
    )
    webRouter.post(
      '/project/:project_id/thread/:thread_id/messages',
      AuthorizationMiddleware.blockRestrictedUserFromProject,
      AuthorizationMiddleware.ensureUserCanWriteOrReviewProjectContent,
      TrackChangesController.sendComment
    )
    webRouter.post(
      '/project/:project_id/thread/:thread_id/messages/:message_id/edit',
      AuthorizationMiddleware.blockRestrictedUserFromProject,
      AuthorizationMiddleware.ensureUserCanWriteOrReviewProjectContent,
      TrackChangesController.editMessage
    )
    webRouter.delete(
      '/project/:project_id/thread/:thread_id/messages/:message_id',
      AuthorizationMiddleware.blockRestrictedUserFromProject,
      AuthorizationMiddleware.ensureUserCanWriteOrReviewProjectContent,
      TrackChangesController.deleteMessage
    )
    webRouter.post(
      '/project/:project_id/doc/:doc_id/thread/:thread_id/resolve',
      AuthorizationMiddleware.blockRestrictedUserFromProject,
      AuthorizationMiddleware.ensureUserCanDeleteOrResolveThread,
      TrackChangesController.resolveThread
    )
    webRouter.post(
      '/project/:project_id/doc/:doc_id/thread/:thread_id/reopen',
      AuthorizationMiddleware.blockRestrictedUserFromProject,
      AuthorizationMiddleware.ensureUserCanDeleteOrResolveThread,
      TrackChangesController.reopenThread
    )
    webRouter.delete(
      '/project/:project_id/doc/:doc_id/thread/:thread_id',
      AuthorizationMiddleware.blockRestrictedUserFromProject,
      AuthorizationMiddleware.ensureUserCanDeleteOrResolveThread,
      TrackChangesController.deleteThread
    )
  }
}
