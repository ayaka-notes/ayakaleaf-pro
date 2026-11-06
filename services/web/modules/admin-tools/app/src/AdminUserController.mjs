import Path from 'node:path'
import { fileURLToPath } from 'node:url'
import Settings from '@overleaf/settings'
import { expressify } from '@overleaf/promise-utils'
import { User } from '../../../../app/src/models/User.mjs'
import { DeletedUser } from '../../../../app/src/models/DeletedUser.mjs'
import SessionManager from '../../../../app/src/Features/Authentication/SessionManager.mjs'
import UserSessionsManager from '../../../../app/src/Features/User/UserSessionsManager.mjs'
import ErrorController from '../../../../app/src/Features/Errors/ErrorController.mjs'
import PersonalAccessTokenManager from '../../../oauth2-server/app/src/OAuthPersonalAccessTokenManager.mjs'
import { GitHubSyncUserCredentials } from '../../../github-sync/app/models/githubSyncUserCredentials.mjs'
import { GitLabSyncUserCredentials } from '../../../gitlab-sync/app/models/gitlabSyncUserCredentials.mjs'
import { GiteaSyncUserCredentials } from '../../../gitea-sync/app/models/giteaSyncUserCredentials.mjs'
import {
  formatUser,
  getProviderIds,
  getProviderNames,
} from './AdminUsersController.mjs'
import { logOnUser } from './AdminAuditLog.mjs'
import { userIdOr404 } from './AdminUserListsController.mjs'

const __dirname = Path.dirname(fileURLToPath(import.meta.url))

const USER_FIELDS = [
  '_id',
  'email',
  'emails.email',
  'emails.confirmedAt',
  'emails.reconfirmedAt',
  'first_name',
  'last_name',
  'isAdmin',
  'suspended',
  'signUpDate',
  'lastLoggedIn',
  'lastLoginIp',
  'lastActive',
  'loginCount',
  'hashedPassword',
  'samlIdentifiers.providerId',
  'samlIdentifiers.externalUserId',
  'thirdPartyIdentifiers.providerId',
  'thirdPartyIdentifiers.externalUserId',
  'features',
  'aiFeatures.enabled',
  'refProviders',
  // what DropboxHandler.isLinked checks; that file needs Settings.dropbox,
  // which the dropbox module sets only after this module is loaded
  'dropbox.access_token.uid',
]

// A login method keeps a property in sync when its settings say so; the
// admin can then not change it
function lockedOnLogin(authMethods) {
  const methods = authMethods.map(m => m.type).filter(t => t !== 'pending')
  const all = test => methods.length > 0 && methods.every(test)
  return {
    details: all(m => m !== 'local' && Boolean(Settings[m]?.updateUserDetailsOnLogin)),
    isAdmin: all(
      m =>
        m !== 'local' &&
        Boolean(Settings[m]?.attAdmin) &&
        Boolean(Settings[m]?.valAdmin)
    ),
  }
}

function formatDetails(user, providerNames) {
  const summary = formatUser(user, providerNames)
  return {
    ...summary,
    hasPassword:
      typeof user.hashedPassword === 'string' && user.hashedPassword !== '',
    lastLoginIp: user.lastLoginIp || undefined,
    emails: (user.emails ?? []).map(email => ({
      email: email.email,
      primary: email.email === user.email,
      confirmed: Boolean(email.reconfirmedAt || email.confirmedAt),
    })),
    identifiers: [
      ...(user.samlIdentifiers ?? []).map(id => ({
        type: 'saml',
        externalUserId: id.externalUserId,
      })),
      ...(user.thirdPartyIdentifiers ?? []).map(id => ({
        type: 'oidc',
        providerId: id.providerId,
        name: providerNames[id.providerId] ?? id.providerId,
        externalUserId: id.externalUserId,
      })),
    ],
    locked: lockedOnLogin(summary.authMethods),
    features: user.features ?? {},
    aiEnabled: user.aiFeatures?.enabled !== false,
  }
}

async function getIntegrations(user) {
  const userId = user._id
  const [tokens, github, gitlab, gitea] = await Promise.all([
    // tokens keep user_id as a string (the session's user id)
    PersonalAccessTokenManager.listTokens(userId.toString()),
    GitHubSyncUserCredentials.exists({ userId }),
    GitLabSyncUserCredentials.exists({ userId }),
    GiteaSyncUserCredentials.exists({ userId }),
  ])
  return {
    gitTokens: tokens.map(token => ({
      id: token._id.toString(),
      prefix: token.accessTokenPartial,
      createdAt: token.createdAt,
      expiresAt: token.accessTokenExpiresAt,
      lastUsedAt: token.lastUsedAt,
    })),
    linked: {
      github: Boolean(github),
      gitlab: Boolean(gitlab),
      gitea: Boolean(gitea),
      dropbox: Boolean(user.dropbox?.access_token?.uid),
      zotero: Boolean(user.refProviders?.zotero),
      mendeley: Boolean(user.refProviders?.mendeley),
    },
  }
}

async function userPage(req, res) {
  const { userId } = req.params
  if (!/^[0-9a-f]{24}$/i.test(userId)) {
    return ErrorController.notFound(req, res)
  }
  const providerNames = getProviderNames(await getProviderIds())
  const sessionUserId = SessionManager.getLoggedInUserId(req.session)

  const user = await User.findById(userId, USER_FIELDS.join(' ')).lean().exec()
  if (user) {
    const [integrations, sessions] = await Promise.all([
      getIntegrations(user),
      UserSessionsManager.promises.getAllUserSessions(user, []),
    ])
    return res.render(Path.resolve(__dirname, '../views/admin-user'), {
      title: 'user_management',
      adminUser: {
        user: formatDetails(user, providerNames),
        integrations,
        sessions,
        sessionUserId,
      },
      adminUsersOptions: { sessionUserId },
    })
  }

  // a deleted user keeps its document in deletedUsers until it expires
  const deletedUser = await DeletedUser.findOne({
    'deleterData.deletedUserId': userId,
    user: { $type: 'object' },
  })
    .lean()
    .exec()
  if (!deletedUser) {
    return ErrorController.notFound(req, res)
  }
  const { deleterData } = deletedUser
  const deleter =
    deleterData.deleterId &&
    (await User.findById(deleterData.deleterId, 'email').lean().exec())
  res.render(Path.resolve(__dirname, '../views/admin-user'), {
    title: 'user_management',
    adminUser: {
      user: {
        ...formatDetails(deletedUser.user, providerNames),
        deleted: true,
        deletedAt: deleterData.deletedAt,
      },
      deleter: {
        id: deleterData.deleterId?.toString(),
        email: deleter?.email,
        ipAddress: deleterData.deleterIpAddress,
      },
      sessionUserId,
    },
    adminUsersOptions: { sessionUserId },
  })
}

// Same steps as core's own UserController.clearSessions, with the admin as
// initiator; the admin's current session is kept when it is their own page
async function clearSessions(req, res) {
  const userId = userIdOr404(req, res)
  if (!userId) return
  const user = await User.findById(userId, '_id').lean().exec()
  if (!user) {
    return ErrorController.notFound(req, res)
  }
  const sessions = await UserSessionsManager.promises.getAllUserSessions(user, [
    req.sessionID,
  ])
  await logOnUser(req, user._id, 'clear-sessions', { sessions })
  await UserSessionsManager.promises.removeSessionsFromRedis(
    user,
    req.sessionID
  )
  res.json({
    sessions: await UserSessionsManager.promises.getAllUserSessions(user, []),
  })
}

export default {
  userPage: expressify(userPage),
  clearSessions: expressify(clearSessions),
}
