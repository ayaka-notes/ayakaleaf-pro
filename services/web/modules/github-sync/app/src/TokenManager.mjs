import logger from '@overleaf/logger'
import OError from '@overleaf/o-error'
import AccessTokenEncryptor from '@overleaf/access-token-encryptor'
import Mongo from '../../../../app/src/Features/Helpers/Mongo.mjs'
import { GitHubSyncUserCredentials } from '../models/githubSyncUserCredentials.mjs'
import { InvalidTokenError } from './GitSyncErrors.mjs'
import GitHubApiClient from './GitHubApiClient.mjs'

const { normalizeQuery } = Mongo

// encrypt / decrypt helpers
const accessTokenEncryptor = new AccessTokenEncryptor({
  cipherLabel: process.env.GITHUB_TOKEN_CIPHER_LABEL || "2026.3-v3",
  cipherPasswords: {
    [process.env.GITHUB_TOKEN_CIPHER_LABEL || "2026.3-v3"]: process.env.GITHUB_TOKEN_CIPHER_PASSWORD,
  },
})

async function encryptAccessToken(accessToken) {
  try {
    return await accessTokenEncryptor.promises.encryptJson(accessToken)
  } catch (err) {
    throw OError.tag('failed to encrypt token', err)
  }
}

async function decryptAccessToken(tokenEncrypted) {
  try {
    return await accessTokenEncryptor.promises.decryptToJson(tokenEncrypted)
  } catch (err) {
    throw new InvalidTokenError('failed to decrypt token', { status: 401 }, err)
  }
}

// ------------------------- exports -------------------------- //
async function getUserToken(userId) {
  const credentials = await GitHubSyncUserCredentials.findOne(normalizeQuery({ userId }))
  if (!credentials) throw new InvalidTokenError('no user token', { userId, status: 400 })
  return await decryptAccessToken(credentials.github)
}

async function saveUserToken(userId, accessToken) {
  const tokenEncrypted = await encryptAccessToken(accessToken)
  const previous = await GitHubSyncUserCredentials.findOneAndUpdate(
    normalizeQuery({ userId }),
    { $set: { github: tokenEncrypted } },
    { upsert: true }
  )
  // linking again (e.g. another account) replaces the token: revoke the old
  // one, fire-and-forget like removeUserToken
  if (previous) {
    decryptAccessToken(previous.github)
      .then(token => GitHubApiClient.revokeToken(token))
      .catch(err => {
        logger.warn({ err, userId }, 'failed to revoke replaced user token')
      })
  }
}

// Try to revoke user's token, then remove it
async function removeUserToken(userId) {
  let token
  try {
    token = await getUserToken(userId)
  } catch (err) {
    logger.warn({ err, userId }, 'failed to get user token')
  }
  // fire-and-forget, but still handle errors
  if (token) {
    GitHubApiClient.revokeToken(token).catch(err => {
      logger.warn({ err, userId }, 'failed to revoke user token')
    })
  }
  await GitHubSyncUserCredentials.deleteOne(normalizeQuery({ userId }))
  return
}

export default {
  saveUserToken,
  getUserToken,
  removeUserToken
}
