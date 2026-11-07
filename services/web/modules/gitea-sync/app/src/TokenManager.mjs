import OError from '@overleaf/o-error'
import AccessTokenEncryptor from '@overleaf/access-token-encryptor'
import Mongo from '../../../../app/src/Features/Helpers/Mongo.mjs'
import LockManager from '../../../../app/src/infrastructure/LockManager.mjs'
import { GiteaSyncUserCredentials } from '../models/giteaSyncUserCredentials.mjs'
import { InvalidTokenError } from './GitSyncErrors.mjs'
import GiteaApiClient from './GiteaApiClient.mjs'

const { normalizeQuery } = Mongo

// refresh a little before Gitea expires the access token (after 1 hour)
const EXPIRY_MARGIN_MS = 5 * 60 * 1000

const RefreshLockManager = LockManager.withTimeout(60)

// encrypt / decrypt helpers
const accessTokenEncryptor = new AccessTokenEncryptor({
  cipherLabel: process.env.GITEA_TOKEN_CIPHER_LABEL || "2026.10-v3",
  cipherPasswords: {
    [process.env.GITEA_TOKEN_CIPHER_LABEL || "2026.10-v3"]: process.env.GITEA_TOKEN_CIPHER_PASSWORD,
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
  const credentials = await GiteaSyncUserCredentials.findOne(normalizeQuery({ userId }))
  if (!credentials) throw new InvalidTokenError('no user token', { userId, status: 400 })
  return await decryptCredentials(credentials.gitea)
}

function isExpiring({ expiresAt }) {
  return expiresAt != null && expiresAt - EXPIRY_MARGIN_MS < Date.now()
}

// Gitea replaces the refresh token on use (and may spend the old one), so
// refreshes of one user must not run in parallel: the second one re-reads
// the credentials the first saved
async function refreshUserToken(userId) {
  return await RefreshLockManager.promises.runWithLock('giteaSyncToken', userId, async () => {
    const credentials = await getUserCredentials(userId)
    if (!isExpiring(credentials)) return credentials.accessToken

    if (!credentials.refreshToken) {
      throw new InvalidTokenError('token expired', { userId, status: 401 })
    }

    let refreshed
    try {
      refreshed = await GiteaApiClient.refreshAccessToken(credentials.refreshToken)
    } catch (err) {
      // Gitea answers 400 invalid_grant (or unauthorized_client) for a
      // revoked, expired or spent refresh token
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
  return await GiteaSyncUserCredentials.findOneAndUpdate(
    normalizeQuery({ userId }),
    { $set: { gitea: credentialsEncrypted } },
    { upsert: true }
  )
}

// Gitea has no API to revoke an OAuth token: unlinking forgets it, and the
// user revokes the grant in Gitea (Settings > Applications)
async function removeUserToken(userId) {
  await GiteaSyncUserCredentials.deleteOne(normalizeQuery({ userId }))
}

export default {
  saveUserToken,
  getUserToken,
  removeUserToken
}
