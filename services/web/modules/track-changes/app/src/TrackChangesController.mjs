import ChatApiHandler from '../../../../app/src/Features/Chat/ChatApiHandler.mjs'
import ChatManager from '../../../../app/src/Features/Chat/ChatManager.mjs'
import EditorRealTimeController from '../../../../app/src/Features/Editor/EditorRealTimeController.mjs'
import SessionManager from '../../../../app/src/Features/Authentication/SessionManager.mjs'
import UserInfoManager from '../../../../app/src/Features/User/UserInfoManager.mjs'
import UserInfoController from '../../../../app/src/Features/User/UserInfoController.mjs'
import DocstoreManager from '../../../../app/src/Features/Docstore/DocstoreManager.mjs'
import DocumentUpdaterHandler from '../../../../app/src/Features/DocumentUpdater/DocumentUpdaterHandler.mjs'
import CollaboratorsGetter from '../../../../app/src/Features/Collaborators/CollaboratorsGetter.mjs'
import { Project } from '../../../../app/src/models/Project.mjs'
import pLimit from 'p-limit'

const TrackChangesController = {
  async trackChanges(req, res, next) {
    try {
      const { project_id } = req.params
      // merge into the stored state: on_for replaces the members, on_for_guests only toggles __guests__
      const project = await Project.findById(project_id, { track_changes: 1 }).lean()
      const { __guests__, ...members } = project?.track_changes instanceof Object ? project.track_changes : {}
      const state = { ...(req.body.on_for || members) }
      const guests = req.body.on_for_guests ?? __guests__
      if (guests) state.__guests__ = true
      await Project.updateOne({_id: project_id}, {track_changes: state}).exec()  //do not wait?
      EditorRealTimeController.emitToRoom(project_id, 'toggle-track-changes', state)
      res.sendStatus(204)
    } catch (err) {
      next(err)
    }
  },
  async acceptChanges(req, res, next) {
    try {
      const { project_id, doc_id } = req.params
      const change_ids = req.body.change_ids
      EditorRealTimeController.emitToRoom(project_id, 'accept-changes', doc_id, change_ids)
      await DocumentUpdaterHandler.promises.acceptChanges(project_id, doc_id, change_ids)
      res.sendStatus(204)
    } catch (err) {
      next(err)
    }
  },
  async getAllRanges(req, res, next) {
    try {
      const { project_id } = req.params
      const ranges = await DocumentUpdaterHandler.promises.getProjectRanges(project_id)
      res.json(ranges)
    } catch (err) {
      next(err)
    }
  },
  async getChangesUsers(req, res, next) {
// This route was previously used by the frontend to retrieve names of users who made changes or comments.
// review-panel-new no longer needs this for comments, but still relies on it for changes -
// although the frontend knows the names of the current owner and members, it depends on the data
// provided here to assign names to authors who have left the project but still have unaccepted changes.
    try {
      const { project_id } = req.params
      const memberIds = await DocstoreManager.promises.getTrackedChangesUserIds(project_id)
      const limit = pLimit(3)
      const users = await Promise.all(
        memberIds.map(memberId =>
          limit(async () => {
            const user = await UserInfoManager.promises.getPersonalInfo(memberId)
            return UserInfoController.formatPersonalInfo(user)
          })
        )
      )
      res.json(users)
    } catch (err) {
      next(err)
    }
  },
  async getThreads(req, res, next) {
    try {
      const { project_id } = req.params
      const messages = await ChatApiHandler.promises.getThreads(project_id)
      await ChatManager.promises.injectUserInfoIntoThreads(messages)
      res.json(messages)
    } catch (err) {
      next(err)
    }
  },
  async sendComment(req, res, next) {
    try {
      const { project_id, thread_id } = req.params
      const { content } = req.body
      const user_id = SessionManager.getLoggedInUserId(req.session)
      if (!user_id) throw new Error('no logged-in user')
      const message = await ChatApiHandler.promises.sendComment(project_id, thread_id, user_id, content)
      const user = await UserInfoManager.promises.getPersonalInfo(user_id)
      message.user = UserInfoController.formatPersonalInfo(user)
      EditorRealTimeController.emitToRoom(project_id, 'new-comment', thread_id, message)
      res.sendStatus(204)
    } catch (err) {
      next(err)
    }
  },
  async editMessage(req, res, next) {
    try {
      const { project_id, thread_id, message_id } = req.params
      const { content } = req.body
      const user_id = SessionManager.getLoggedInUserId(req.session)
      if (!user_id) throw new Error('no logged-in user')
      await ChatApiHandler.promises.editMessage(project_id, thread_id, message_id, user_id, content)
      EditorRealTimeController.emitToRoom(project_id, 'edit-message', thread_id, message_id, content)
      res.sendStatus(204)
    } catch (err) {
      next(err)
    }
  },
  async deleteMessage(req, res, next) {
    try {
      const { project_id, thread_id, message_id } = req.params
      await ChatApiHandler.promises.deleteMessage(project_id, thread_id, message_id)
      EditorRealTimeController.emitToRoom(project_id, 'delete-message', thread_id, message_id)
      res.sendStatus(204)
    } catch (err) {
      next(err)
    }
  },
  async resolveThread(req, res, next) {
    try {
      const { project_id, doc_id, thread_id } = req.params
      const user_id = SessionManager.getLoggedInUserId(req.session)
      if (!user_id) throw new Error('no logged-in user')
      const user = await UserInfoManager.promises.getPersonalInfo(user_id)
      await ChatApiHandler.promises.resolveThread(project_id, thread_id, user_id)
      EditorRealTimeController.emitToRoom(
        project_id,
        'resolve-thread',
        thread_id,
        UserInfoController.formatPersonalInfo(user)
      )
      await DocumentUpdaterHandler.promises.resolveThread(project_id, doc_id, thread_id, user_id)
      res.sendStatus(204)
    } catch (err) {
      next(err)
    }
  },
  async reopenThread(req, res, next) {
    try {
      const { project_id, doc_id, thread_id } = req.params
      const user_id = SessionManager.getLoggedInUserId(req.session)
      if (!user_id) throw new Error('no logged-in user')
      await ChatApiHandler.promises.reopenThread(project_id, thread_id)
      EditorRealTimeController.emitToRoom(project_id, 'reopen-thread', thread_id)
      await DocumentUpdaterHandler.promises.reopenThread(project_id, doc_id, thread_id, user_id)
      res.sendStatus(204)
    } catch (err) {
      next(err)
    }
  },
  async deleteThread(req, res, next) {
    try {
      const { project_id, doc_id, thread_id } = req.params
      const user_id = SessionManager.getLoggedInUserId(req.session)
      if (!user_id) throw new Error('no logged-in user')
      await ChatApiHandler.promises.deleteThread(project_id, thread_id)
      EditorRealTimeController.emitToRoom(project_id, 'delete-thread', thread_id)
      await DocumentUpdaterHandler.promises.deleteThread(project_id, doc_id, thread_id, user_id)
      res.sendStatus(204)
    } catch (err) {
      next(err)
    }
  },
}

export default TrackChangesController
