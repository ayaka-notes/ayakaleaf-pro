import logger from '@overleaf/logger'
import Mongo from '../../../../app/src/Features/Helpers/Mongo.mjs'
import { WakaTimeUserCredentials } from '../models/wakaTimeUserCredentials.mjs'
import { AccessTokenEncryptor } from './AccessTokenEncryptorHelper.mjs'

const { normalizeQuery } = Mongo

/**
 * Decrypt stored WakaTime credentials for a user.
 * Returns { apiUrl, apiKey } or null if not linked.
 */
async function getCredentials(userId) {
  const record = await WakaTimeUserCredentials.findOne(
    normalizeQuery({ userId })
  ).exec()

  if (!record?.apiKeyEncrypted) return null

  try {
    const apiKey = await AccessTokenEncryptor.decryptToJson(
      record.apiKeyEncrypted
    )
    return { apiUrl: record.apiUrl, apiKey }
  } catch (err) {
    logger.error(
      { userId, err },
      'failed to decrypt WakaTime credentials, treating as not connected'
    )
    return null
  }
}

/**
 * Link a WakaTime (or Wakapi-compatible) account.
 */
async function storeCredentials(userId, apiUrl, apiKey) {
  const apiKeyEncrypted = await AccessTokenEncryptor.encryptJson(apiKey)
  await WakaTimeUserCredentials.findOneAndUpdate(
    normalizeQuery({ userId }),
    { $set: { apiUrl, apiKeyEncrypted } },
    { upsert: true }
  ).exec()
}

async function removeCredentials(userId) {
  await WakaTimeUserCredentials.deleteOne(normalizeQuery({ userId })).exec()
}

export default {
  getCredentials,
  storeCredentials,
  removeCredentials,
}
