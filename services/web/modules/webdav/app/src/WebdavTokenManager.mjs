import logger from '@overleaf/logger'
import OError from '@overleaf/o-error'
import { encrypt, decrypt } from './WebdavTokenEncryption.mjs'
import { WebdavUserCredentials } from '../models/webdavUserCredentials.mjs'

/**
 * Get user's WebDAV credentials
 * Retrieves and decrypts the stored credentials for a user's WebDAV connection.
 *
 * @param {string} userId - The Overleaf user ID
 * @returns {Promise<Object>} Decrypted credentials object with baseUrl, username, password/token
 * @throws {OError} If no credentials found or decryption fails
 */
async function getUserCredentials(userId) {
  try {
    const credentials = await WebdavUserCredentials.findOne({ userId })
    if (!credentials) {
      throw new Error(`No WebDAV credentials found for user: ${userId}`)
    }
    return await decrypt(credentials.credentials)
  } catch (err) {
    logger.error({ err, userId }, 'Failed to get user WebDAV credentials')
    throw OError.tag(err, 'Failed to retrieve user WebDAV credentials', { userId })
  }
}

/**
 * Save user's WebDAV credentials
 * Encrypts and stores the provided credentials in the database.
 *
 * @param {string} userId - The Overleaf user ID
 * @param {Object} credentials - Credentials object with baseUrl, username, password/token
 */
async function saveUserCredentials(userId, credentials) {
  try {
    const encrypted = await encrypt(credentials)
    await WebdavUserCredentials.findOneAndUpdate(
      { userId },
      { $set: { credentials: encrypted } },
      { upsert: true, new: true }
    )
  } catch (err) {
    logger.error({ err, userId }, 'Failed to save user WebDAV credentials')
    throw OError.tag(err, 'Failed to save user WebDAV credentials', { userId })
  }
}

/**
 * Remove user's WebDAV credentials
 * Deletes the stored credentials from the database.
 *
 * @param {string} userId - The Overleaf user ID
 */
async function removeUserCredentials(userId) {
  try {
    await WebdavUserCredentials.deleteOne({ userId })
  } catch (err) {
    logger.error({ err, userId }, 'Failed to remove user WebDAV credentials')
    throw OError.tag(err, 'Failed to remove user WebDAV credentials', { userId })
  }
}

/**
 * Rename a project inside the stored credentials (syncedProjects list and
 * remoteState keys). Used by WebdavSync.moveEntityForLinkedUsers — the call
 * used to reference a method that was never exported (WD-14).
 *
 * @param {string} userId
 * @param {string} oldProjectName
 * @param {string} newProjectName
 */
async function renameProject(userId, oldProjectName, newProjectName) {
  const record = await WebdavUserCredentials.findOne({ userId })
  if (!record?.credentials) return
  const credentials = await decrypt(record.credentials)
  let changed = false
  const hasOwn = Object.prototype.hasOwnProperty
  if (Array.isArray(credentials.syncedProjects)) {
    if (credentials.syncedProjects.includes(oldProjectName)) {
      credentials.syncedProjects = credentials.syncedProjects.map(name =>
        name === oldProjectName ? newProjectName : name
      )
      changed = true
    }
  }
  if (
    credentials.remoteState &&
    hasOwn.call(credentials.remoteState, oldProjectName)
  ) {
    credentials.remoteState[newProjectName] = credentials.remoteState[oldProjectName]
    delete credentials.remoteState[oldProjectName]
    changed = true
  }
  if (!changed) return
  await saveUserCredentials(userId, credentials, { force: true })
}

/**
 * Get all users with linked WebDAV accounts
 * Returns a list of Overleaf user IDs that have configured WebDAV connections.
 *
 * @returns {Promise<Array<string>>} Array of user IDs with linked WebDAV accounts
 */
async function getLinkedUserIds() {
  try {
    const credentials = await WebdavUserCredentials.find({}, { userId: 1, _id: 0 })
    return credentials.map(c => c.userId)
  } catch (err) {
    logger.error({ err }, 'Failed to get linked user IDs')
    throw OError.tag(err, 'Failed to retrieve linked user IDs')
  }
}

export default {
  /**
   * Get user's WebDAV credentials
   * @param {string} userId - The Overleaf user ID
   * @returns {Promise<Object>} Decrypted credentials object
   */
  getUserCredentials,
  
  /**
   * Save user's WebDAV credentials
   * @param {string} userId - The Overleaf user ID
   * @param {Object} credentials - Credentials object to encrypt and store
   */
  saveUserCredentials,

  /**
   * Rename a synced project inside the stored credentials
   * @param {string} userId - The Overleaf user ID
   * @param {string} oldProjectName - Previous project name
   * @param {string} newProjectName - New project name
   */
  renameProject,
  
  /**
   * Remove user's WebDAV credentials
   * @param {string} userId - The Overleaf user ID
   */
  removeUserCredentials,
  
  /**
   * Get all users with linked WebDAV accounts
   * @returns {Promise<Array<string>>} Array of user IDs with linked accounts
   */
  getLinkedUserIds,
}