import logger from '@overleaf/logger'
import http from 'node:http'
import https from 'node:https'
import Settings from '@overleaf/settings'
import TpdsUpdateSender from '../ThirdPartyDataStore/TpdsUpdateSender.mjs'
import TpdsProjectFlusher from '../ThirdPartyDataStore/TpdsProjectFlusher.mjs'
import EditorRealTimeController from '../Editor/EditorRealTimeController.mjs'
import SystemMessageManager from '../SystemMessages/SystemMessageManager.mjs'
import ProjectGetter from '../Project/ProjectGetter.mjs'
import Modules from '../../infrastructure/Modules.mjs'
import Features from '../../infrastructure/Features.mjs'
import { expressify } from '@overleaf/promise-utils'
import { z, zz, parseReq } from '../../infrastructure/Validation.mjs'

const closeEditorSchema = z.object({
  body: z.strictObject({
    // the real form (views/admin/index.pug) never actually sends this
    // field; a falsy/missing value is treated as "closed"
    isOpen: z.boolean().optional(),
  }),
})

const disconnectAllUsersSchema = z.object({
  query: z.object({
    delay: z.coerce.number().optional(),
  }),
})

// Rollout-temporary fallback (loosened primary schema; no zod validation
// existed for this route on main); delete when this route's
// REQ_VALIDATION_MODE instrumentation is removed. `delay` is used
// numerically below, so a raw passthrough still needs to coerce it.
const disconnectAllUsersFallbackSchema = z.object({
  query: z.object({
    delay: z
      .unknown()
      .optional()
      .transform(v => (v === undefined ? undefined : Number(v))),
  }),
})

const flushProjectToTpdsSchema = z.object({
  body: z.object({
    project_id: zz.objectId(),
  }),
})

const pollDropboxForUserSchema = z.object({
  body: z.object({
    user_id: zz.objectId(),
  }),
})

const createMessageSchema = z.object({
  body: z.strictObject({
    content: z.string(),
    // #17b: where the message is shown; missing → all pages
    placements: z
      .array(z.enum(['editor', 'hub', 'auth']))
      .optional(),
    // #17d: hide the dismiss (X) button for this message
    unremovable: z.boolean().optional(),
  }),
})

const updateMessageSchema = z.object({
  params: z.object({
    id: zz.objectId(),
  }),
  body: z.strictObject({
    placements: z
      .array(z.enum(['editor', 'hub', 'auth']))
      .optional(),
    // #17d: hide the dismiss (X) button for this message
    unremovable: z.boolean().optional(),
  }),
})

const deleteMessageSchema = z.object({
  params: z.object({
    id: zz.objectId(),
  }),
})

const AdminController = {
  _sendDisconnectAllUsersMessage: delay => {
    return EditorRealTimeController.emitToAll(
      'forceDisconnect',
      'Sorry, we are performing a quick update to the editor and need to close it down. Please refresh the page to continue.',
      delay
    )
  },
  // Admin page (classic panel): the System Messages pane moved to the
  // React page at /admin/messages, so it no longer lists the DB here.
  index: expressify(async (req, res, next) => {
    let url
    const openSockets = {}
    for (url in http.globalAgent.sockets) {
      openSockets[`http://${url}`] = http.globalAgent.sockets[url].map(
        socket => socket._httpMessage.path
      )
    }

    for (url in https.globalAgent.sockets) {
      openSockets[`https://${url}`] = https.globalAgent.sockets[url].map(
        socket => socket._httpMessage.path
      )
    }

    const privilegesMatrixResults = await Modules.promises.hooks.fire(
      'getPrivilegesMatrix'
    )

    const privilegesMatrix = privilegesMatrixResults[0] || null

    const toRender = {
      title: 'System Admin',
      openSockets,
      privilegesMatrix,
    }

    if (Features.hasFeature('saas')) {
      const debugProjects = await ProjectGetter.promises.findAllDebugProjects(
        'name lastUpdated owner_ref'
      )
      toRender.debugProjects = debugProjects
    }
    res.render('admin/index', toRender)
  }),

  disconnectAllUsers: (req, res) => {
    logger.warn('disconecting everyone')
    const { query } = parseReq(req, disconnectAllUsersSchema, {
      logOnly: true,
      fallbackSchema: disconnectAllUsersFallbackSchema,
    })
    const delay = query.delay > 0 ? query.delay : 10
    AdminController._sendDisconnectAllUsersMessage(delay)
    res.redirect('/admin#open-close-editor')
  },

  openEditor(req, res) {
    logger.warn('opening editor')
    Settings.editorIsOpen = true
    res.redirect('/admin#open-close-editor')
  },

  closeEditor(req, res) {
    logger.warn('closing editor')
    const { body } = parseReq(req, closeEditorSchema, { logOnly: true })
    Settings.editorIsOpen = body.isOpen
    res.redirect('/admin#open-close-editor')
  },

  flushProjectToTpds(req, res, next) {
    const { body } = parseReq(req, flushProjectToTpdsSchema, {
      logOnly: true,
    })
    TpdsProjectFlusher.flushProjectToTpds(body.project_id, error => {
      if (error) {
        return next(error)
      }
      res.sendStatus(200)
    })
  },

  pollDropboxForUser(req, res) {
    const { body } = parseReq(req, pollDropboxForUserSchema, {
      logOnly: true,
    })
    TpdsUpdateSender.pollDropboxForUser(body.user_id, () => res.sendStatus(200))
  },

  // The clients of these endpoints are the React page at /admin/messages
  // (fetch-based), so they answer with JSON status codes rather than the
  // 302 redirects the old classic form flow used.
  createMessage(req, res, next) {
    const { body } = parseReq(req, createMessageSchema, { logOnly: true })
    SystemMessageManager.createMessage(
      body.content,
      body.placements,
      body.unremovable ?? false,
      function (error) {
        if (error) {
          return next(error)
        }
        res.sendStatus(200)
      }
    )
  },

  // #17b: update where a message is shown (placements).
  // #17d: optionally toggle the dismiss (X) button via `unremovable`.
  // Both fields may be sent independently; only the ones present update.
  updateMessage: expressify(async (req, res, next) => {
    const { params, body } = parseReq(req, updateMessageSchema, {
      logOnly: true,
    })
    if (body.placements !== undefined) {
      await SystemMessageManager.promises.updateMessagePlacements(
        params.id,
        body.placements
      )
    }
    if (body.unremovable !== undefined) {
      await SystemMessageManager.promises.setMessageUnremovable(
        params.id,
        body.unremovable
      )
    }
    res.sendStatus(200)
  }),

  // #17c: delete a single message.
  deleteMessage(req, res, next) {
    const { params } = parseReq(req, deleteMessageSchema, { logOnly: true })
    SystemMessageManager.deleteMessage(params.id, function (error) {
      if (error) {
        return next(error)
      }
      res.sendStatus(200)
    })
  },

  // The admin page lists the DB directly so it always manages the real
  // messages — the public GET /system/messages endpoint overrides the
  // list with the synthetic 'protected' message when the site is closed.
  getMessagesJSON(req, res, next) {
    SystemMessageManager.getMessagesFromDB(function (error, messages) {
      if (error) {
        return next(error)
      }
      res.json(messages || [])
    })
  },

  clearMessages(req, res, next) {
    SystemMessageManager.clearMessages(function (error) {
      if (error) {
        return next(error)
      }
      res.sendStatus(200)
    })
  },
}

export default AdminController
