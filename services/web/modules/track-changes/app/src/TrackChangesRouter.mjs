import express from 'express'
import logger from '@overleaf/logger'
import { expressify } from '@overleaf/promise-utils'
import HttpErrorHandler from '../../../../app/src/Features/Errors/HttpErrorHandler.mjs'
import AuthorizationMiddleware from '../../../../app/src/Features/Authorization/AuthorizationMiddleware.mjs'
import ProjectHelper from '../../../../app/src/Features/Project/ProjectHelper.mjs'
import { Project } from '../../../../app/src/models/Project.mjs'
import {
  projectOwnerHasFeature,
  runBeforeCoreRoutes,
} from '../../../instance-features/app/src/UserFeatures.mjs'
import TrackChangesController from './TrackChangesController.mjs'

// Without the owner's feature a project cannot turn tracking on, and gets no
// new reviewers, whose edits would be tracked. Comments and the changes it
// already has stay usable, as in core, whose editor reads the same feature.
const refuseTrackingWithoutFeature = shouldCheck =>
  expressify(async (req, res, next) => {
    if (
      !(await shouldCheck(req)) ||
      (await projectOwnerHasFeature(
        req.params.project_id ?? req.params.Project_id,
        'trackChanges'
      ))
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

// Core's sharing routes (CollaboratorsRouter.mjs)
const sharingRoutes = express.Router()
sharingRoutes.post(
  '/project/:Project_id/invite',
  refuseTrackingWithoutFeature(req => req.body?.privileges === 'review')
)
sharingRoutes.put(
  '/project/:Project_id/users/:user_id',
  refuseTrackingWithoutFeature(req => req.body?.privilegeLevel === 'review')
)

export default {
  apply(webRouter) {
    logger.debug({}, 'Init track-changes router')

    runBeforeCoreRoutes(webRouter, sharingRoutes)

    webRouter.post(
      '/project/:project_id/track_changes',
      AuthorizationMiddleware.blockRestrictedUserFromProject,
      AuthorizationMiddleware.ensureUserCanWriteProjectContent,
      refuseTrackingWithoutFeature(turnsTrackingOn),
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
