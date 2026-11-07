import logger from '@overleaf/logger'
import OError from '@overleaf/o-error'
import AccessTokenEncryptor from '@overleaf/access-token-encryptor'
import Mongo from '../../../../app/src/Features/Helpers/Mongo.mjs'
import LockManager from '../../../../app/src/infrastructure/LockManager.mjs'
import { GitLabSyncUserCredentials } from '../models/gitlabSyncUserCredentials.mjs'
import { InvalidTokenError } from './GitSyncErrors.mjs'
import GitLabApiClient from './GitLabApiClient.mjs'

const { normalizeQuery } = Mongo

// refresh a little before GitLab expires the access token
const EXPIRY_MARGIN_MS = 5 * 60 * 1000

const RefreshLockManager = LockManager.withTimeout(60)

// encrypt / decrypt helpers
const accessTokenEncryptor = new AccessTokenEncryptor({
  cipherLabel: process.env.GITLAB_TOKEN_CIPHER_LABEL || "2026.10-v3",
  cipherPasswords: {
    [process.env.GITLAB_TOKEN_CIPHER_LABEL || "2026.10-v3"]: process.env.GITLAB_TOKEN_CIPHER_PASSWORD,
  },
})

async function encryptCredentials(credentials) {
  try {
    return await accessTokenEncryptor.promises.encryptJson(credentials)
  } catch (err) {
    throw OError.tag('failed to encrypt token', err)
  }
}

async function decryptCredentials(credentialsEncrypted) {
  try {
    return await accessTokenEncryptor.promises.decryptToJson(credentialsEncrypted)
  } catch (err) {
    throw new InvalidTokenError('failed to decrypt token', { status: 401 }, err)
  }
}

async function getUserCredentials(userId) {
  const credentials = await GitLabSyncUserCredentials.findOne(normalizeQuery({ userId }))
  if (!credentials) throw new InvalidTokenError('no user token', { userId, status: 400 })
  return await decryptCredentials(credentials.gitlab)
}

function isExpiring({ expiresAt }) {
  return expiresAt != null && expiresAt - EXPIRY_MARGIN_MS < Date.now()
}

// GitLab spends the refresh token on use, so refreshes of one user must not
// run in parallel: the second one re-reads the credentials the first saved
async function refreshUserToken(userId) {
  return await RefreshLockManager.promises.runWithLock('gitlabSyncToken', userId, async () => {
    const credentials = await getUserCredentials(userId)
    if (!isExpiring(credentials)) return credentials.accessToken

    if (!credentials.refreshToken) {
      throw new InvalidTokenError('token expired', { userId, status: 401 })
    }

    let refreshed
    try {
      refreshed = await GitLabApiClient.refreshAccessToken(credentials.refreshToken)
    } catch (err) {
      // GitLab answers 400 invalid_grant for a revoked or spent refresh token
      const status = OError.getFullInfo(err)?.status
      if (status === 400 || status === 401) {
        throw new InvalidTokenError('failed to refresh token', { userId, status: 401 }, err)
      }
      throw err
    }
    if (!refreshed) throw new InvalidTokenError('failed to refresh token', { userId, status: 401 })

    await saveUserToken(userId, refreshed)
    return refreshed.accessToken
  })
}

// ------------------------- exports -------------------------- //
async function getUserToken(userId) {
  const credentials = await getUserCredentials(userId)
  if (isExpiring(credentials)) return await refreshUserToken(userId)
  return credentials.accessToken
}

// credentials: { accessToken, refreshToken, expiresAt }
async function saveUserToken(userId, credentials) {
  const credentialsEncrypted = await encryptCredentials(credentials)
  return await GitLabSyncUserCredentials.findOneAndUpdate(
    normalizeQuery({ userId }),
    { $set: { gitlab: credentialsEncrypted } },
    { upsert: true }
  )
}

// Linking again (e.g. another account) replaces the credentials: revoke the
// old token, fire-and-forget like removeUserToken
async function linkUserToken(userId, credentials) {
  const previous = await saveUserToken(userId, credentials)
  if (previous) {
    decryptCredentials(previous.gitlab)
      .then(old => GitLabApiClient.revokeToken(old.accessToken))
      .catch(err => {
        logger.warn({ err, userId }, 'failed to revoke replaced user token')
      })
  }
}

// Try to revoke user's token, then remove it
async function removeUserToken(userId) {
  let credentials
  try {
    credentials = await getUserCredentials(userId)
  } catch (err) {
    logger.warn({ err, userId }, 'failed to get user token')
  }
  // fire-and-forget, but still handle errors
  if (credentials) {
    GitLabApiClient.revokeToken(credentials.accessToken).catch(err => {
      logger.warn({ err, userId }, 'failed to revoke user token')
    })
  }
  await GitLabSyncUserCredentials.deleteOne(normalizeQuery({ userId }))
  return
}

export default {
  saveUserToken,
  linkUserToken,
  getUserToken,
  removeUserToken
}
