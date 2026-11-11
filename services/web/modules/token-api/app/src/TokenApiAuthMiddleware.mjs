import logger from '@overleaf/logger'
import AuthorizationManager from '../../../../app/src/Features/Authorization/AuthorizationManager.mjs'
import ChatApiHandler from '../../../../app/src/Features/Chat/ChatApiHandler.mjs'
import CollaboratorsGetter from '../../../../app/src/Features/Collaborators/CollaboratorsGetter.mjs'
import PrivilegeLevels from '../../../../app/src/Features/Authorization/PrivilegeLevels.mjs'
import Errors from '../../../../app/src/Features/Errors/Errors.js'
import {
  InvalidParamsError,
  parseReq,
  z,
} from '../../../../app/src/infrastructure/Validation.mjs'
// Git-bridge personal access tokens live in oauthAccessTokens and are managed
// by the oauth2-server module (this fork has no GitBridgePATManager).
import PersonalAccessTokenManager from '../../../oauth2-server/app/src/OAuthPersonalAccessTokenManager.mjs'

export const ID_REGEX = /^[0-9a-f]{24}$/
// Not zz.objectId(): ObjectId.isValid also accepts upper-case hex and any
// 12-character string.
export const objectId = z.string().regex(ID_REGEX)
const BEARER = /^Bearer\s+(\S+)$/i

// verifyToken does not filter by type or scope, and the token table also
// holds other access token types: only accept personal access tokens
// scoped to the git bridge, as the editor's git routes do.
async function getUserId(token) {
  const tokenInstance = await PersonalAccessTokenManager.verifyToken(token)
  if (!tokenInstance) return null
  if (tokenInstance.type !== 'personal_access_token') return null
  if (!/\bgit_bridge\b/.test(tokenInstance.scope || '')) return null
  return tokenInstance.user_id
}

// Members only: no site-admin shortcut, no legacy public access.
const MEMBER_LEVELS = [
  PrivilegeLevels.OWNER,
  PrivilegeLevels.READ_AND_WRITE,
  PrivilegeLevels.READ_ONLY,
  PrivilegeLevels.REVIEW,
]

function unauthorized(req, res, reason) {
  logger.info({ ip: req.ip, path: req.path, reason }, 'token-api: unauthorized')
  res.status(401).json({ error: 'unauthorized' })
}

export function notFound(res) {
  res.status(404).json({ error: 'not found' })
}

// project_id on every route; doc_id and thread_id where the path has them.
const idsSchema = z.object({
  params: z.object({
    project_id: objectId,
    doc_id: objectId.optional(),
    thread_id: objectId.optional(),
  }),
})

export default async function tokenProjectAccess(req, res, next) {
  try {
    res.set('Cache-Control', 'no-store')
    const match = BEARER.exec((req.headers.authorization || '').trim())
    if (!match) {
      return unauthorized(req, res, 'missing or malformed authorization header')
    }
    const userId = await getUserId(match[1])
    if (!userId) return unauthorized(req, res, 'invalid token')

    let projectId
    // One audit line per authenticated request, including 404s and aborted
    // connections ('close' fires in both cases, 'finish' only on success).
    res.on('close', () => {
      logger.info(
        {
          userId,
          projectId,
          method: req.method,
          path: req.path,
          status: res.writableFinished ? res.statusCode : 'aborted',
        },
        'token-api request'
      )
    })

    // Malformed ids answer 404 before the membership check sees them.
    try {
      projectId = parseReq(req, idsSchema).params.project_id
    } catch (err) {
      if (err instanceof InvalidParamsError) return notFound(res)
      throw err
    }

    let level
    try {
      level = await AuthorizationManager.promises.getPrivilegeLevelForProject(
        userId,
        projectId,
        null,
        { ignoreSiteAdmin: true, ignorePublicAccess: true }
      )
    } catch (err) {
      if (err instanceof Errors.NotFoundError) return notFound(res)
      throw err
    }
    if (!MEMBER_LEVELS.includes(level)) return notFound(res)
    // Restricted users (read-only via a sharing link, not invited) see no
    // comments in the editor and the review routes block them
    // (blockRestrictedUserFromProject). Here they are treated as non-members.
    if (
      level === PrivilegeLevels.READ_ONLY &&
      AuthorizationManager.isRestrictedUser(
        userId,
        level,
        await CollaboratorsGetter.promises.userIsTokenMember(userId, projectId),
        await CollaboratorsGetter.promises.isUserInvitedMemberOfProject(
          userId,
          projectId
        )
      )
    ) {
      return notFound(res)
    }

    // A string, as in a session: canResolveThread compares it with the
    // user_id strings that chat returns.
    req.tokenUserId = userId.toString()
    req.tokenPrivilegeLevel = level
    next()
  } catch (err) {
    next(err)
  }
}

// Resolve and reopen, after tokenProjectAccess. Mirrors core's
// AuthorizationManager.canUserDeleteOrResolveThread (behind the editor's
// ensureUserCanDeleteOrResolveThread): owners and editors on any thread,
// reviewers only on threads whose first message they wrote; a missing thread
// or any chat error denies. Not called directly because core does not ignore
// site admins there, and the level here was computed with ignoreSiteAdmin.
async function canResolveThread(level, userId, projectId, threadId) {
  if (
    level === PrivilegeLevels.OWNER ||
    level === PrivilegeLevels.READ_AND_WRITE
  ) {
    return true
  }
  if (level !== PrivilegeLevels.REVIEW) return false
  try {
    const thread = await ChatApiHandler.promises.getThread(projectId, threadId)
    return thread.messages.length > 0 && thread.messages[0].user_id === userId
  } catch (err) {
    return false
  }
}

export async function tokenThreadResolveAccess(req, res, next) {
  try {
    const { project_id: projectId, thread_id: threadId } = parseReq(
      req,
      idsSchema
    ).params
    const allowed = await canResolveThread(
      req.tokenPrivilegeLevel,
      req.tokenUserId,
      projectId,
      threadId
    )
    if (!allowed) return res.status(403).json({ error: 'forbidden' })
    next()
  } catch (err) {
    next(err)
  }
}
