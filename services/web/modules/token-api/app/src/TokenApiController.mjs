import { readFileSync } from 'node:fs'
import { fetchNothing, RequestFailedError } from '@overleaf/fetch-utils'
import logger from '@overleaf/logger'
import settings from '@overleaf/settings'
import { ObjectId } from 'mongodb'
import ChatApiHandler from '../../../../app/src/Features/Chat/ChatApiHandler.mjs'
import DocstoreManager from '../../../../app/src/Features/Docstore/DocstoreManager.mjs'
import DocumentUpdaterHandler from '../../../../app/src/Features/DocumentUpdater/DocumentUpdaterHandler.mjs'
import EditorRealTimeController from '../../../../app/src/Features/Editor/EditorRealTimeController.mjs'
import ProjectEntityHandler from '../../../../app/src/Features/Project/ProjectEntityHandler.mjs'
import ProjectGetter from '../../../../app/src/Features/Project/ProjectGetter.mjs'
import UserGetter from '../../../../app/src/Features/User/UserGetter.mjs'
import UserInfoController from '../../../../app/src/Features/User/UserInfoController.mjs'
import UserInfoManager from '../../../../app/src/Features/User/UserInfoManager.mjs'
import {
  InvalidRequestError,
  parseReq,
  z,
} from '../../../../app/src/infrastructure/Validation.mjs'
import { ID_REGEX, notFound, objectId } from './TokenApiAuthMiddleware.mjs'

// The module README doubles as the API documentation, served at GET /api/v1.
let README = null
try {
  README = readFileSync(new URL('../../README.md', import.meta.url), 'utf8')
} catch (err) {
  logger.warn(
    { err },
    'token-api: README.md not found, GET /api/v1 answers 404'
  )
}

const MAX_MESSAGE_LENGTH = 10 * 1024 // chat's limit
const MAX_QUOTE_LENGTH = 10 * 1024

// A bad request body, or a 404 (unknown thread, comment not in that doc) or
// 400 from chat or document-updater, becomes the API's fixed body; anything
// else is a 500.
function handleWriteError(err, res, next) {
  if (err instanceof InvalidRequestError) {
    return res.status(400).json({ error: 'bad request' })
  }
  if (err instanceof RequestFailedError) {
    if (err.response.status === 404) return notFound(res)
    if (err.response.status === 400) {
      return res.status(400).json({ error: 'bad request' })
    }
  }
  next(err)
}

function iso(value) {
  if (value == null) return null
  const date = new Date(value)
  return isNaN(date) ? null : date.toISOString()
}

// '2026-10-10T12:34:56.789Z' -> '2026-10-10 12:34'
function shortTime(isoString) {
  return isoString ? isoString.slice(0, 16).replace('T', ' ') : '?'
}

// op.p counts UTF-16 code units of lines.join('\n'), as does String.slice.
function lineAt(text, offset) {
  return text.slice(0, offset).split('\n').length
}

// First two occurrences of quote in text: enough to tell unique from ambiguous.
function findOffsets(text, quote) {
  const first = text.indexOf(quote)
  if (first === -1) return []
  const second = text.indexOf(quote, first + 1)
  return second === -1 ? [first] : [first, second]
}

// UTF-16 offsets (what ShareJS counts): true if i falls between the halves of a surrogate pair.
function splitsSurrogatePair(text, i) {
  return (
    /[\uD800-\uDBFF]/.test(text[i - 1] ?? '') &&
    /[\uDC00-\uDFFF]/.test(text[i] ?? '')
  )
}

function byFileLine(a, b) {
  if (a.file !== b.file) {
    if (a.file == null) return 1
    if (b.file == null) return -1
    return a.file < b.file ? -1 : 1
  }
  if (a.line !== b.line) {
    if (a.line == null) return 1
    if (b.line == null) return -1
    return a.line - b.line
  }
  return 0
}

async function getAuthors(userIds) {
  const ids = [...new Set(userIds.filter(id => id && ID_REGEX.test(id)))]
  const users = await UserGetter.promises.getUsers(ids, {
    first_name: 1,
    last_name: 1,
  })
  const names = new Map()
  for (const user of users) {
    const name = `${user.first_name || ''} ${user.last_name || ''}`.trim()
    names.set(user._id.toString(), name || null)
  }
  return id => (id ? { id, name: names.get(id) ?? null } : null)
}

function toMarkdown(view) {
  const out = [
    `# ${view.project.name}: review comments (${shortTime(view.generated_at)} UTC)`,
  ]
  let currentFile
  for (const thread of view.threads) {
    if (thread.file !== currentFile) {
      currentFile = thread.file
      out.push('', `## ${thread.file ?? '(no file)'}`)
    }
    const state = thread.resolved ? 'resolved' : 'open'
    const where = thread.line != null ? `Line ${thread.line}` : 'Thread'
    out.push('', `### ${where} (${state}) [thread ${thread.id}]`)
    if (thread.quote != null) {
      out.push(...thread.quote.split('\n').map(line => `> ${line}`))
    }
    if (thread.messages.length > 0) out.push('')
    for (const message of thread.messages) {
      const name = message.author?.name ?? message.author?.id ?? 'unknown'
      out.push(
        `- **${name}**, ${shortTime(message.time)}: ${message.content.replaceAll('\n', '\n  ')}`
      )
    }
  }
  if (view.changes.length > 0) {
    out.push('', '## Tracked changes')
    for (const change of view.changes) {
      const name = change.author?.name ?? change.author?.id ?? 'unknown'
      const where = `${change.file ?? '(no file)'}:${change.line ?? '?'}`
      // JSON string literal: newlines and backticks cannot break the list item
      out.push(
        `- ${where} ${change.type} by ${name}, ${shortTime(change.time)}: ${JSON.stringify(change.text)}`
      )
    }
  }
  return out.join('\n') + '\n'
}

// Ids are already checked by the middleware (malformed -> 404).
const projectSchema = z.object({
  params: z.object({ project_id: objectId }),
})

const getThreadsSchema = z.object({
  params: z.object({ project_id: objectId }),
  // Any other format (or a repeated one) falls back to JSON, never 400.
  query: z.object({ format: z.literal('md').optional().catch(undefined) }),
})

// Content rules as in chat: not blank, at most chat's length limit.
const contentSchema = z
  .string()
  .max(MAX_MESSAGE_LENGTH)
  .refine(s => s.trim() !== '')

const sendMessageSchema = z.object({
  params: z.object({ project_id: objectId, thread_id: objectId }),
  body: z.object({ content: contentSchema }),
})

const createCommentSchema = z.object({
  params: z.object({ project_id: objectId }),
  body: z.object({
    file: z.string().min(1),
    quote: z.string().min(1).max(MAX_QUOTE_LENGTH),
    content: contentSchema,
    // Number.isInteger, not .int(): .int() also caps at MAX_SAFE_INTEGER.
    offset: z.number().min(0).refine(Number.isInteger).optional(),
  }),
})

const docThreadSchema = z.object({
  params: z.object({
    project_id: objectId,
    doc_id: objectId,
    thread_id: objectId,
  }),
})

const TokenApiController = {
  docs(req, res) {
    if (README == null) return notFound(res)
    res.type('text/markdown; charset=utf-8').send(README)
  },

  async getRanges(req, res, next) {
    try {
      const { project_id } = parseReq(req, projectSchema).params
      // Flush unflushed edits to docstore (docs stay loaded), then read all docs from there.
      await DocumentUpdaterHandler.promises.flushProjectToMongo(project_id)
      const docs = await DocstoreManager.promises.getAllRanges(project_id)
      res.json(docs.map(doc => ({ id: doc._id, ranges: doc.ranges ?? {} })))
    } catch (err) {
      next(err)
    }
  },

  async getThreads(req, res, next) {
    try {
      const { params, query } = parseReq(req, getThreadsSchema)
      const { project_id } = params
      await DocumentUpdaterHandler.promises.flushProjectToMongo(project_id)
      // lines and ranges from one docstore read, so offsets match the text
      const [project, paths, docs, chatThreads] = await Promise.all([
        ProjectGetter.promises.getProject(project_id, { name: 1 }),
        ProjectEntityHandler.promises.getAllDocPathsFromProjectById(project_id),
        DocstoreManager.promises.getAllDocsWithRanges(project_id),
        ChatApiHandler.promises.getThreads(project_id),
      ])

      const anchors = new Map()
      const rawChanges = []
      for (const doc of docs) {
        const docId = doc._id.toString()
        const file = paths[docId]?.replace(/^\//, '') ?? null
        const text = (doc.lines ?? []).join('\n')
        const locate = p => ({
          file,
          line: file != null ? lineAt(text, p) : null,
        })
        for (const comment of doc.ranges?.comments ?? []) {
          anchors.set(String(comment.op.t), {
            doc_id: docId,
            ...locate(comment.op.p),
            quote: comment.op.c,
          })
        }
        for (const change of doc.ranges?.changes ?? []) {
          rawChanges.push({ change, ...locate(change.op.p) })
        }
      }

      const userIds = []
      for (const thread of Object.values(chatThreads)) {
        userIds.push(thread.resolved_by_user_id)
        for (const message of thread.messages ?? [])
          userIds.push(message.user_id)
      }
      for (const { change } of rawChanges)
        userIds.push(change.metadata?.user_id)
      const author = await getAuthors(
        userIds.map(id => (id ? String(id) : null))
      )

      const threadIds = new Set([
        ...Object.keys(chatThreads),
        ...anchors.keys(),
      ])
      const threads = [...threadIds].map(id => {
        const chat = chatThreads[id] ?? {}
        const anchor = anchors.get(id) ?? {
          doc_id: null,
          file: null,
          line: null,
          quote: null,
        }
        return {
          id,
          doc_id: anchor.doc_id,
          file: anchor.file,
          line: anchor.line,
          quote: anchor.quote,
          resolved: !!chat.resolved,
          resolved_at: iso(chat.resolved_at),
          resolved_by: chat.resolved_by_user_id
            ? author(String(chat.resolved_by_user_id))
            : null,
          messages: (chat.messages ?? []).map(m => ({
            id: m.id,
            author: m.user_id ? author(String(m.user_id)) : null,
            time: iso(m.timestamp),
            edited_at: iso(m.edited_at),
            content: m.content,
          })),
        }
      })
      const firstTime = t => t.messages[0]?.time ?? ''
      threads.sort(
        (a, b) => byFileLine(a, b) || firstTime(a).localeCompare(firstTime(b))
      )

      const changes = rawChanges.map(({ change, file, line }) => ({
        id: change.id,
        file,
        line,
        type: change.op.i != null ? 'insert' : 'delete',
        text: change.op.i ?? change.op.d,
        author: change.metadata?.user_id
          ? author(String(change.metadata.user_id))
          : null,
        time: iso(change.metadata?.ts),
      }))
      changes.sort(byFileLine)

      const view = {
        project: { id: project_id, name: project?.name ?? null },
        generated_at: new Date().toISOString(),
        threads,
        changes,
      }
      if (query.format === 'md') {
        res.type('text/markdown; charset=utf-8').send(toMarkdown(view))
      } else {
        res.json(view)
      }
    } catch (err) {
      next(err)
    }
  },

  async sendMessage(req, res, next) {
    try {
      const { params, body } = parseReq(req, sendMessageSchema)
      const { project_id, thread_id } = params
      const { content } = body
      // Reading a thread does not create it; sending to one does. Reject
      // unknown IDs instead of creating an orphan thread without an anchor.
      await ChatApiHandler.promises.getThread(project_id, thread_id)
      const userId = req.tokenUserId
      const user = await UserInfoManager.promises.getPersonalInfo(userId)
      const message = await ChatApiHandler.promises.sendComment(
        project_id,
        thread_id,
        userId,
        content
      )
      message.user = UserInfoController.formatPersonalInfo(user)
      EditorRealTimeController.emitToRoom(
        project_id,
        'new-comment',
        thread_id,
        message
      )
      res.status(201).json({
        id: message.id,
        time: iso(message.timestamp),
        content: message.content,
      })
    } catch (err) {
      handleWriteError(err, res, next)
    }
  },

  async createComment(req, res, next) {
    try {
      const { params, body } = parseReq(req, createCommentSchema)
      const { project_id } = params
      const { file, quote, content, offset } = body
      const wanted = file.replace(/^\//, '')
      const paths =
        await ProjectEntityHandler.promises.getAllDocPathsFromProjectById(
          project_id
        )
      const docId = Object.keys(paths).find(
        id => paths[id].replace(/^\//, '') === wanted
      )
      if (!docId) return notFound(res)

      const { lines, version } =
        await DocumentUpdaterHandler.promises.getDocument(project_id, docId, -1)
      const text = lines.join('\n')
      let at = offset
      if (at !== undefined) {
        if (text.slice(at, at + quote.length) !== quote) {
          return res
            .status(409)
            .json({ error: 'conflict', reason: 'quote not at offset' })
        }
      } else {
        const offsets = findOffsets(text, quote)
        if (offsets.length === 0) {
          return res
            .status(409)
            .json({ error: 'conflict', reason: 'quote not found' })
        }
        if (offsets.length > 1) {
          return res
            .status(409)
            .json({ error: 'conflict', reason: 'quote ambiguous' })
        }
        at = offsets[0]
      }
      if (
        splitsSurrogatePair(text, at) ||
        splitsSurrogatePair(text, at + quote.length)
      ) {
        return res.status(400).json({ error: 'bad request' })
      }
      const line = lineAt(text, at)

      const threadId = new ObjectId().toString()
      const userId = req.tokenUserId
      const user = await UserInfoManager.promises.getPersonalInfo(userId)
      // Creates the thread; the anchor below makes it visible in the doc.
      const message = await ChatApiHandler.promises.sendComment(
        project_id,
        threadId,
        userId,
        content
      )
      // Editors learn the thread before the op arrives, as with the editor's own flow.
      message.user = UserInfoController.formatPersonalInfo(user)
      EditorRealTimeController.emitToRoom(
        project_id,
        'new-comment',
        threadId,
        message
      )
      try {
        // All three IDs are 24-hex: project_id checked by the middleware,
        // docId from the project, threadId generated above.
        await fetchNothing(
          `${settings.apis.documentupdater.url}/project/${project_id}/doc/${docId}/comment`,
          {
            method: 'POST',
            json: {
              thread_id: threadId,
              user_id: userId,
              text: quote,
              offset: at,
              version,
            },
            signal: AbortSignal.timeout(30 * 1000),
          }
        )
      } catch (err) {
        // Roll back both sides. After a timeout the outcome is unknown, so the
        // range is removed too (a no-op if it was never applied).
        const warn = (e, what) =>
          logger.warn(
            { err: e, projectId: project_id, docId, threadId },
            `token-api: ${what} after failed anchor`
          )
        await DocumentUpdaterHandler.promises
          .deleteThread(project_id, docId, threadId, userId)
          .catch(e => warn(e, 'could not remove range'))
        await ChatApiHandler.promises
          .deleteThread(project_id, threadId)
          .catch(e => warn(e, 'could not delete thread'))
        EditorRealTimeController.emitToRoom(
          project_id,
          'delete-thread',
          threadId
        )
        if (err instanceof RequestFailedError) {
          // 422: text or version changed, too many comments, or not a ShareJS doc
          if (err.response.status === 422) {
            return res
              .status(409)
              .json({ error: 'conflict', reason: 'anchor rejected' })
          }
          if (err.response.status === 404) return notFound(res)
        }
        return next(err)
      }

      res.status(201).json({
        thread_id: threadId,
        doc_id: docId,
        file: paths[docId].replace(/^\//, ''),
        line,
        quote,
        message: {
          id: message.id,
          time: iso(message.timestamp),
          content: message.content,
        },
      })
    } catch (err) {
      handleWriteError(err, res, next)
    }
  },

  async resolveThread(req, res, next) {
    try {
      const { params } = parseReq(req, docThreadSchema)
      const { project_id, doc_id, thread_id } = params
      // 404 unless the comment is anchored in this doc of this project; the
      // chat write below must not happen for a wrong doc_id.
      await DocumentUpdaterHandler.promises.getComment(
        project_id,
        doc_id,
        thread_id
      )
      const userId = req.tokenUserId
      const user = await UserInfoManager.promises.getPersonalInfo(userId)
      await ChatApiHandler.promises.resolveThread(project_id, thread_id, userId)
      EditorRealTimeController.emitToRoom(
        project_id,
        'resolve-thread',
        thread_id,
        UserInfoController.formatPersonalInfo(user)
      )
      await DocumentUpdaterHandler.promises.resolveThread(
        project_id,
        doc_id,
        thread_id,
        userId
      )
      res.sendStatus(204)
    } catch (err) {
      handleWriteError(err, res, next)
    }
  },

  async reopenThread(req, res, next) {
    try {
      const { params } = parseReq(req, docThreadSchema)
      const { project_id, doc_id, thread_id } = params
      await DocumentUpdaterHandler.promises.getComment(
        project_id,
        doc_id,
        thread_id
      )
      await ChatApiHandler.promises.reopenThread(project_id, thread_id)
      EditorRealTimeController.emitToRoom(
        project_id,
        'reopen-thread',
        thread_id
      )
      await DocumentUpdaterHandler.promises.reopenThread(
        project_id,
        doc_id,
        thread_id,
        req.tokenUserId
      )
      res.sendStatus(204)
    } catch (err) {
      handleWriteError(err, res, next)
    }
  },
}

export default TokenApiController
