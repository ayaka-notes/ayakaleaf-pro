import logger from '@overleaf/logger'
import { User } from '../../../../app/src/models/User.mjs'
import { AccessTokenEncryptor } from './AccessTokenEncryptorHelper.mjs'

/**
 * Decrypt stored Zotero credentials from user record.
 * Returns { apiKey, zoteroUserId } or null if not linked.
 */
async function getCredentials(userId) {
  const user = await User.findById(userId, 'refProviders.zotero').exec()

  if (!user?.refProviders?.zotero?.apiKeyEncrypted) return null

  try {
    const decrypted = await AccessTokenEncryptor.decryptToJson(
      user.refProviders.zotero.apiKeyEncrypted
    )
    return decrypted
  } catch (err) {
    logger.error({ userId, err }, 'failed to decrypt Zotero credentials, treating as not connected')
    return null
  }
}

/**
 * Link a Zotero account (store encrypted credentials).
 */
async function storeCredentials(userId, apiKey, zoteroUserId) {
  const apiKeyEncrypted = await AccessTokenEncryptor.encryptJson({
    apiKey,
    zoteroUserId: String(zoteroUserId),
  })
  await User.updateOne(
    { _id: userId },
    { $set: { 'refProviders.zotero': { apiKeyEncrypted } } }
  ).exec()
}


export default {
  getCredentials,
  storeCredentials,
}
