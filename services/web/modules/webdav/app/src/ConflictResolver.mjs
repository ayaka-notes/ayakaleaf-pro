import OError from '@overleaf/o-error'
import logger from '@overleaf/logger'
import crypto from 'node:crypto'

import SyncStateManager from './SyncStateManager.mjs'
import WebdavSync from './WebdavSync.mjs'
import WebdavCredentials from './WebdavCredentials.mjs'
import { ConflictError } from './ConflictErrors.mjs'

/**
 * Error class for when a conflict is not found in the system.
 * thrown when attempting to resolve a conflict that doesn't exist
 * or has already been resolved.
 */
class ConflictNotFoundError extends OError {
  /**
   * Creates a new ConflictNotFoundError instance.
   * 
   * @param {string} message - Human-readable error message
   * @param {Object} [details={}] - Additional error details
   */
  constructor(message, details = {}) {
    super(message, { ...details, type: 'ConflictNotFoundError' })
    this.name = 'ConflictNotFoundError'
    this.details = details
  }
}

/**
 * Calculate SHA256 hash of content
 * 
 * @param {string|Buffer} content - Content to hash
 * @returns {string|null} Hex string representation of the hash, or null if input is empty/invalid
 */
function calculateHash(content) {
  if (!content) return null
  const buffer = typeof content === 'string' ? Buffer.from(content, 'utf8') : content
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

/**
 * Get project's conflict state
 * Retrieves the current conflict status for a project linked to WebDAV.
 * 
 * @param {string|ObjectId} projectId - The Overleaf project ID
 * @returns {Promise<Object>} Project's conflict state document or null if no conflicts exist
 */
async function getProjectConflictState(projectId) {
  return await SyncStateManager.getProjectState(projectId)
}

/**
 * Detect if a file has a conflict based on ETag/hash comparison
 * Called after pollRemoteSync detects modified files. Checks whether the file
 * is already in conflict state or should be flagged for conflict resolution.
 * 
 * @param {Object} options - Conflict detection parameters
 * @param {string} options.projectId - Project ID
 * @param {string} options.path - File path
 * @param {string} options.localHash - Current version hash in Overleaf
 * @param {string} options.remoteETag - ETag from WebDAV server
 * @returns {Promise<Object>} Conflict detection result with 'exists' boolean and optional data
 */
async function detectConflict({ projectId, path, localHash, remoteETag }) {
  // Get project's current state
  const projectState = await SyncStateManager.getProjectState(projectId)
  
  if (!projectState) {
    throw new Error('Project not linked to WebDAV')
  }

  // Check if this file is already in conflict state
  const existingConflict = projectState.lastConflict?.path === path

  if (existingConflict) {
    return { exists: true, path, localHash, remoteETag }
  }

  // Note (C2): the previous code tried to accumulate `conflictingPaths` via a
  // `$push` passed INSIDE `$set` (stored as a literal field, never an array).
  // Nothing reads that field (the frontend only reads `lastConflict`), so the
  // accumulation is dropped entirely rather than half-fixed.

  return { exists: false, shouldCheckNextPoll: true }
}

/**
 * Get both versions of a conflicted file
 * Retrieves the local (Overleaf) and remote (WebDAV) versions of a file
 * that is currently in conflict state.
 * 
 * @param {string} projectId - Project ID
 * @param {string} path - Path of conflicting file
 * @returns {Promise<Object>} Object with 'local' and 'remote' version details
 * @throws {ConflictNotFoundError} If no active conflict exists for the given path
 */
async function getConflictingVersions(projectId, path) {
  const conflictState = await SyncStateManager.getProjectState(projectId)

  if (!conflictState || !conflictState.lastConflict || conflictState.lastConflict.path !== path) {
    throw new ConflictNotFoundError(`No active conflict for path: ${path}`, { projectId, path })
  }

  return {
    local: conflictState.lastConflict.versions.local,
    remote: conflictState.lastConflict.versions.remote,
  }
}

/**
 * Resolve a conflict by keeping one version — REAL content work (C2).
 *
 * The previous implementation only touched state (and stored `$unset` inside
 * `$set`, a no-op), so conflicts could never be resolved from the UI. Now:
 *   - 'local'  → WebdavSync pushes the Overleaf content to the remote
 *   - 'remote' → WebdavSync pulls the remote content into the Overleaf project
 * and only AFTER the content work succeeds is the conflict state cleared with
 * a proper Mongo update ($set and $unset as separate operators).
 *
 * Note: sync conflicts are recorded on the user's credentials document
 * (lastConflict) by WebdavSync — the project state document is an additional
 * (legacy) location, so both are consulted for the "conflict exists" check.
 *
 * @param {string|ObjectId} userId - Requesting user (performs the sync work)
 * @param {string|ObjectId} projectId - Project ID
 * @param {string} path - Path of the conflicted file
 * @param {'local'|'remote'} choice - Which version to keep
 * @returns {Promise<Object>} Resolution result with 'success: true', 'choice', and 'path'
 * @throws {ConflictNotFoundError} If no active conflict exists for the given path
 * @throws {Error} If the sync work itself fails (state is then NOT cleared)
 */
function conflictMatches(conflict, projectId, path) {
  if (!conflict || conflict.path !== path) return false
  if (conflict.projectId) {
    return conflict.projectId.toString() === projectId.toString()
  }
  return true
}

async function resolve(userId, projectId, path, choice) {
  if (choice !== 'local' && choice !== 'remote') {
    throw new Error(`Invalid choice: ${choice}. Must be 'local' or 'remote'`)
  }

  const [projectState, credentials] = await Promise.all([
    SyncStateManager.getProjectState(projectId),
    userId ? WebdavCredentials.get(userId) : Promise.resolve(null),
  ])

  const conflictExists =
    conflictMatches(projectState?.lastConflict, projectId, path) ||
    conflictMatches(credentials?.lastConflict, projectId, path)
  if (!conflictExists) {
    throw new ConflictNotFoundError(`Conflict not found for: ${path}`, { projectId, path })
  }

  try {
    // Real content work (propagates on failure — state must NOT be cleared):
    // 'local' → keep Overleaf's version (push local to remote)
    // 'remote' → keep WebDAV's version (pull remote into the project)
    await WebdavSync.resolveConflict(
      userId,
      projectId,
      path,
      choice === 'local' ? 'keep-local' : 'keep-remote'
    )

    // C2: clear the conflict state with CORRECT, separate Mongo operators.
    await SyncStateManager.updateProjectState(projectId, {
      $set: {
        mergeStatus: 'clean',
        lastSyncAt: new Date(),
        resolvedChoice: choice,
      },
      $unset: {
        lastConflict: 1,
        conflictingPaths: 1,
      },
    })

    logger.info({ userId, projectId, path, choice }, 'Conflict resolved (content pushed/pulled + state cleared)')
    return { success: true, choice, path }
  } catch (err) {
    throw OError.tag(err, `Failed to resolve conflict for ${path}`, { projectId, choice })
  }
}

export default {
  /**
   * Get project's conflict state
   * @param {string|ObjectId} projectId - Project ID
   * @returns {Promise<Object>} Project's conflict state document
   */
  getProjectConflictState,
  
  /**
   * Detect if a file has a conflict based on ETag/hash comparison
   * @param {Object} options - Conflict detection parameters
   * @param {string} options.projectId - Project ID
   * @param {string} options.path - File path
   * @param {string} options.localHash - Current version hash in Overleaf
   * @param {string} options.remoteETag - ETag from WebDAV server
   * @returns {Promise<Object>} Conflict detection result
   */
  detectConflict,
  
  /**
   * Get both versions of a conflicted file
   * @param {string} projectId - Project ID
   * @param {string} path - Path of conflicting file
   * @returns {Promise<Object>} Object with 'local' and 'remote' version details
   */
  getConflictingVersions,
  
  /**
   * Resolve a conflict by keeping one version
   * @param {string} projectId - Project ID
   * @param {string} path - Path of conflicting file
   * @param {'local'|'remote'} choice - Which version to keep
   * @returns {Promise<Object>} Resolution result with 'success: true'
   */
  resolve,
  
  /**
   * Calculate SHA256 hash of content
   * @param {string|Buffer} content - Content to hash
   * @returns {string|null} Hex string representation of the hash
   */
  calculateHash,
  
  /**
   * Error class for when a conflict is not found in the system.
   */
  ConflictNotFoundError,
  
  /**
   * Error class for WebDAV conflict errors (ETag mismatch)
   */
  ConflictError,
}