// Controller for API v0 endpoints used by git-bridge
// These endpoints provide git-bridge with access to project data, versions, and snapshots

import settings from '@overleaf/settings'
import logger from '@overleaf/logger'
import { expressify } from '@overleaf/promise-utils'
import { fetchJson } from '@overleaf/fetch-utils'
import { promises as fsPromises } from 'fs'
import { Snapshot } from 'overleaf-editor-core'
import { pipeline } from 'stream/promises'
import { fetchStream } from '@overleaf/fetch-utils'
import jwt from 'jsonwebtoken'
import fs from 'fs'
import Path from 'path'
import crypto from 'crypto'

import ProjectGetter from '../../../../app/src/Features/Project/ProjectGetter.mjs'
import HistoryManager from '../../../../app/src/Features/History/HistoryManager.mjs'
import UserGetter from '../../../../app/src/Features/User/UserGetter.mjs'
import ProjectEntityHandler from '../../../../app/src/Features/Project/ProjectEntityHandler.mjs'
import FileTypeManager from '../../../../app/src/Features/Uploads/FileTypeManager.mjs'
import EditorController from '../../../../app/src/Features/Editor/EditorController.mjs'
import Errors from '../../../../app/src/Features/Errors/Errors.js'

/**
 * GET /api/v0/docs/:project_id
 * Returns the latest version info for a project
 * Response format:
 * {
 *  latestVerId: number,
 * latestVerAt: string (ISO date),
 * latestVerBy: {
 *   email: string,
 *   name: string
 * }
 */
async function getDoc(req, res, next) {
  const projectId = req.params.project_id
  logger.debug({ projectId }, 'Getting doc info for git-bridge')
  try {
    // Get project to verify it exists
    const project = await ProjectGetter.promises.getProject(projectId, {
      name: 1,
    })

    if (!project) {
      return res.status(404).json({ message: 'Project not found' })
    }

    // Get project from /project/:project_id/snapshot
    const snapshot = await fetchJson(
        `${settings.apis.project_history.url}/project/${projectId}/version`
      )
    
    // get user info from v2Authors
    const userId = snapshot.v2Authors?.[0]
    if (userId) {
        const user = await UserGetter.promises.getUser(userId, { email: 1, first_name: 1, last_name: 1 })
        const user_email = user?.email
        const user_name = user ? `${user.first_name} ${user.last_name}` : undefined

        // logger.info({ user_email, user_name }, 'Found user info for latest snapshot')

        let response = {
          latestVerId: snapshot.version || 0,
          latestVerAt: snapshot.timestamp
            ? new Date(snapshot.timestamp).toISOString()
            : new Date().toISOString(),
          latestVerBy: {
            email: user_email,
            name: user_name,
          }
        }
        res.json(response)
    }
    else {
      // respond with 404 if no author found
      // res.status(404).json({ message: 'No author found for latest snapshot' })
      let response = {
          latestVerId: snapshot.version || 0,
          latestVerAt: snapshot.timestamp
            ? new Date(snapshot.timestamp).toISOString()
            : new Date().toISOString(),
          latestVerBy: {
            email: 'unknown',
            name: 'unknown',
          }
        }
        res.json(response)
    }
  } catch (err) {
    logger.error({ err, projectId }, 'Error getting doc info')
    next(err)
  }
}

/**
 * GET /api/v0/docs/:project_id/saved_vers
 * Returns the list of saved versions (labels) for a project
 * 
 * Labels: user can save a version with a comment
 */
async function getSavedVers(req, res, next) {
  const projectId = req.params.project_id

  try {
    // Get project to verify it exists
    const project = await ProjectGetter.promises.getProject(projectId, {
      name: 1,
    })

    if (!project) {
      return res.status(404).json({ message: 'Project not found' })
    }

    // Get labels from project-history service
    let labels
    try {
      labels = await fetchJson(
        `${settings.apis.project_history.url}/project/${projectId}/labels`
      )
    } catch (err) {
      // If no labels exist, return empty array
      if (err.response?.status === 404) {
        labels = []
      } else {
        throw err
      }
    }
    
    for (let label of labels) {
      const userId = label.user_id
      if (userId) {
        const user = await UserGetter.promises.getUser(userId, { email: 1, first_name: 1, last_name: 1 })
        const user_email = user?.email
        const user_name = user ? `${user.first_name} ${user.last_name}` : undefined
        label.user = {
          email: user_email,
          name: user_name,
        }
      }
    }

    // Transform to git-bridge format
    const savedVers = labels.map(label => ({
      versionId: label.version,
      comment: label.comment,
      user: {
        email: label.user?.email || 'unknown',
        name: label.user?.name || 'unknown',
      },
      createdAt: label.created_at,
    }))

    res.json(savedVers)
  } catch (err) {
    logger.error({ err, projectId }, 'Error getting saved versions')
    next(err)
  }
}

/**
 * For History V1 compatibility: 
 * generate a short-lived JWT token for accessing history data
 */
function generateHistoryToken(projectId) {
  const key = settings.jwt.key
  const algorithm = settings.jwt.algorithm

  // payload need to contain project_id
  return jwt.sign(
    { project_id: projectId },
    key,
    {
      algorithm,
      expiresIn: '5m', // short-lived token
    }
  )
}

/**
 * GET /api/v0/docs/:project_id/snapshots/:version
 * Returns the snapshot (file contents) for a specific version
 * Response format:
 * {
 *  srcs: [ [content: string, path: string], ... ],
 *  atts: [ [url: string, path: string], ... ]
 * }
 * 
 * srcs: array of editable files with their content and path
 * atts: array of binary files with URL to download and path
 */
async function getSnapshot(req, res, next) {
  const projectId = req.params.project_id
  const version = parseInt(req.params.version, 10)

  try {
    // Get project to verify it exists
    const project = await ProjectGetter.promises.getProject(projectId, {
      name: 1,
    })

    if (!project) {
      return res.status(404).json({ message: 'Project not found' })
    }

    // Get snapshot content from history service
    const snapshotRaw = await HistoryManager.promises.getContentAtVersion(
      projectId,
      version
    )

    const snapshot = Snapshot.fromRaw(snapshotRaw)

    // Build response in git-bridge format
    // Note: srcs and atts are arrays of arrays: [[content, path], [content, path], ...]
    const srcs = []
    const atts = []

    // Process all files in the snapshot
    const files = snapshot.getFileMap()
    
    // logger.info({ snapshot })
    // logger.info({ files })
    // "files":{"main.tex":{},"sample.bib":{},"frog.jpg":{},"testFolder/test.tex":{}},
    
    files.map((file, pathname) => {
      // Check file path validity
      let validation = validateFilePath(pathname)
      if (!validation.valid) {
        logger.warn(
          { projectId, pathname, state: validation.state },
          'Invalid file path in snapshot'
        )
        throw new Errors.InvalidNameError(`Invalid file path: ${pathname}`)
      }
      if (file.isEditable()) {
        srcs.push([file.getContent(), pathname])
      } else {
        // Binary file - provide URL to download as [url, path] array
        const hash = file.getHash()
        logger.debug(
          { projectId, pathname, hash },
          'Processing binary file in snapshot'
        )
        // Build URL to blob endpoint (already exists in web service)
        // /project/:project_id/version/:version/:pathname
        const blobUrl = `${settings.apis.v1_history.url}/projects/${projectId}/blobs/${hash}?token=${generateHistoryToken(projectId)}`
        logger.debug(
          { projectId, pathname, blobUrl },
          'Generated blob URL for binary file'
        )
        atts.push([blobUrl, pathname])
      }
    })
    
    const response = {
      srcs,
      atts,
    }

    res.json(response)
  } catch (err) {
    if (err instanceof Errors.NotFoundError) {
      return res.status(404).json({ message: 'Version not found' })
    } else if (err instanceof Errors.InvalidNameError) {
      return res.status(400).json({ message: err.message })
    }
    logger.error({ err, projectId, version }, 'Error getting snapshot')
    next(err)
  }
}

/**
 * POST /api/v0/docs/:project_id/snapshots
 * Receives a push from git-bridge with file changes
 * Git bridge sends:
 * {
 *   latestVerId: number,
 *  files: [ { name: string, url: string | null } ],
 *   postbackUrl: string
 * }
 * 
 * Once the POST is sent, git-bridge starts a file server to 
 * expose the files that have changed at the provided URLs.
 * 
 * Where files is an array of objects with name and optional url (if file has changed)
 * This URL is where the file can be downloaded from **git-bridge** temporarily.
 * If url is null, the file exists but has not changed
 * If a file disappears from the list, it should be deleted.
 * The postbackUrl is where to send the POST request when processing is complete
 * 
 * Once Git-bridge receives POST back, url is no longer valid.
 * 
 * Here we use RealTime API to process the file changes asynchronously,
 */
async function postSnapshot(req, res, next) {
  const projectId = req.params.project_id
  const { latestVerId, files, postbackUrl } = req.body
  
  // Get User ID from OAuth token
  const userId = (req.oauth_user && req.oauth_user._id?.toString()) || null
  

  try {
    // Get project to verify it exists
    const project = await ProjectGetter.promises.getProject(projectId, {
      name: 1,
      rootFolder: 1,
    })

    if (!project) {
      return res.status(404).json({ message: 'Project not found' })
    }

    logger.info(
      { projectId, latestVerId, files: files, postbackUrl },
      'Received snapshot push'
    )


    const snapshot = await fetchJson(
        `${settings.apis.project_history.url}/project/${projectId}/version`
      )

    logger.info(
      { projectId, snapshot },
      'Latest history retrieved for version check'
    )

    let currentVersion = 0
    if (snapshot && snapshot.version ) {
      currentVersion = snapshot.version
    }

    if (latestVerId !== currentVersion) {
      // Version mismatch - return 409 Conflict
      logger.info(
        { projectId, latestVerId, currentVersion },
        'Push rejected: version out of date'
      )

      // Send response immediately
      return res.status(409).json({
        status: 409,
        code: 'outOfDate',
        message: 'Out of Date',
      })
    }

    // Accept the push request immediately (202 Accepted)
    res.status(202).json({
      status: 202,
      code: 'accepted',
      message: 'Accepted',
    })

    // Process the push asynchronously
    processSnapshotPush(projectId, files, postbackUrl, userId).catch(err => {
      logger.error({ err, projectId }, 'Error processing snapshot push')
    })
  } catch (err) {
    logger.error({ err, projectId }, 'Error posting snapshot')
    next(err)
  }
}


/**
 * Process the snapshot push asynchronously
 */
async function processSnapshotPush(projectId, files, postbackUrl, userId) {
  try {
    logger.debug({ projectId, fileCount: files.length }, 'Processing snapshot push')

    // Get all current entities to determine what needs to be deleted
    const { docs, files: existingFiles } =
      await ProjectEntityHandler.promises.getAllEntities(projectId)

    logger.debug(
      { docs, existingFileCount: existingFiles },
      'Retrieved existing project entities'
    )
    
    const existingPaths = new Set()
    // docs is editable docs
    docs.forEach(doc => existingPaths.add(doc.path))
    // existingFiles is blob files
    existingFiles.forEach(file => existingPaths.add(file.path))

    // Track which paths are in the new snapshot, but start with / to match existingPaths format
    const newPaths = new Set(files.map(f => "/" + f.name))

    // Validate files first
    const invalidFiles = []
    for (const file of files) {
      const validation = validateFilePath(file.name)
      if (!validation.valid) {
        invalidFiles.push({
          file: file.name,
          state: validation.state,
          cleanFile: validation.cleanPath,
        })
      }
    }
    
    logger.debug(
      {invalidFiles }, 'File validation completed successfully'
    )

    if (invalidFiles.length > 0) {
      logger.warn({ projectId, invalidFiles }, 'Invalid files in push')
      await sendPostback(postbackUrl, {
        code: 'invalidFiles',
        errors: invalidFiles,
      })
      return
    }

    // Process file updates/creations
    for (const file of files) {
      if (file.url) {
        // File has been modified - download and update it
        await processFileUpdate(projectId, file.name, file.url, userId)
      }
      // If no URL, file exists but hasn't changed - no action needed
    }

    // await sendPostback(postbackUrl, {
    //   code: 'invalidFiles',
    //   errors: invalidFiles
    // })
    // return


    // Delete files that are no longer in the snapshot
    const pathsToDelete = [...existingPaths].filter(path => !newPaths.has(path))
    for (const path of pathsToDelete) {
      try {
        await EditorController.promises.deleteEntityWithPath(
          projectId,
          path,
          'git-bridge',
          userId
        )
        logger.debug({ projectId, path }, 'Deleted file from project')
      } catch (err) {
        // already gone in Overleaf
        if (!(err instanceof Errors.NotFoundError)) throw err
      }
    }

    // Get new version after updates
    const newSnapshot = await fetchJson(
        `${settings.apis.project_history.url}/project/${projectId}/version`
      )
    const newVersion = newSnapshot.version || 0
    

    // Send success postback
    await sendPostback(postbackUrl, {
      code: 'upToDate',
      latestVerId: newVersion,
    })

    // Send invalid files postback for Mock
    // await sendPostback(postbackUrl, {
    //   code: 'invalidFiles',
    //   errors: invalidFiles
    // })

    logger.info({ projectId, newVersion }, 'Snapshot push completed successfully')
  } catch (err) {
    logger.error({ err, projectId }, 'Error in processSnapshotPush')

    // Send error postback
    if (postbackUrl) {
      try {
        await sendPostback(postbackUrl, {
          code: 'error',
          message: 'Unexpected Error',
        })
      } catch (postbackErr) {
        logger.error({ err: postbackErr, projectId }, 'Failed to send error postback')
      }
    }
  }
}

/**
 * Process a single file update
 */
async function processFileUpdate(projectId, filePath, fileUrl, userId) {
  let fsPath = null

  try {
    // Download file to temporary location
    fsPath = await downloadFile(projectId, fileUrl)
    // Determine element path in project
    const elementPath = "/" + filePath

    // Determine if this should be a doc or binary file
    const fileType = await determineFileType(projectId, elementPath, fsPath)

    if (fileType === 'doc') {
      // Process as text document
      const docLines = await readFileIntoTextArray(fsPath)

      logger.debug({ projectId, filePath, docLines }, 'Read doc lines from temporary file')

      await EditorController.promises.upsertDocWithPath(
        projectId,
        elementPath,
        docLines,
        'git-bridge',
        userId
      )
      logger.debug({ projectId, filePath }, 'Updated doc from git-bridge')
    } else {
      // Process as binary file
      await EditorController.promises.upsertFileWithPath(
        projectId,
        elementPath,
        fsPath,
        null, // linkedFileData
        'git-bridge',
        userId
      )
      logger.debug({ projectId, filePath }, 'Updated file from git-bridge')
    }
  } finally {
    // Clean up temporary file
    if (fsPath) {
      try {
        await fsPromises.unlink(fsPath)
      } catch (err) {
        logger.warn({ err, fsPath }, 'Failed to delete temporary file')
      }
    }
  }
}

/**
 * Download a file from git-bridge URL to temporary location
 */
async function downloadFile(projectId, url) {
  const fsPath = Path.join(
    settings.path.dumpFolder,
    `${projectId}_${crypto.randomUUID()}`
  )

  const writeStream = fs.createWriteStream(fsPath)

  try {
    const readStream = await fetchStream(url)
    await pipeline(readStream, writeStream)
    return fsPath
  } catch (err) {
    // Clean up on error
    try {
      await fsPromises.unlink(fsPath)
    } catch (unlinkErr) {
      logger.warn({ err: unlinkErr, fsPath }, 'Failed to delete file after download error')
    }
    throw err
  }
}

/**
 * Determine if a file should be treated as a doc or binary file
 */
async function determineFileType(projectId, path, fsPath) {
  // Check if there is an existing file with the same path
  const { docs, files } =
    await ProjectEntityHandler.promises.getAllEntities(projectId)

  const existingDoc = docs.find(d => d.path === path)
  const existingFile = files.find(f => f.path === path)
  const existingFileType = existingDoc ? 'doc' : existingFile ? 'file' : null

  // Determine whether the update should create a doc or binary file
  const { binary, encoding } = await FileTypeManager.promises.getType(
    path,
    fsPath,
    existingFileType
  )

  // If we receive a non-utf8 encoding, treat as binary
  const isBinary = binary || encoding !== 'utf-8'

  // If a binary file already exists, always keep it as a binary file
  if (existingFileType === 'file') {
    return 'file'
  } else {
    return isBinary ? 'file' : 'doc'
  }
}

/**
 * Read a file into an array of lines
 */
async function readFileIntoTextArray(fsPath) {
  let content = await fsPromises.readFile(fsPath, 'utf8')
  if (content === null || content === undefined) {
    content = ''
  }
  const lines = content.split(/\r\n|\n|\r/)
  return lines
}

/**
 * Validate a file path
 */
function validateFilePath(path) {
  // Check for invalid characters or patterns
  // Git-bridge already handles most validation, but we do basic checks

  if (!path || path.length === 0) {
    return { valid: false, state: 'error' }
  }

  // Check for null bytes
  if (path.includes('\0')) {
    return { valid: false, state: 'error' }
  }

  // Check for suspicious patterns
  if (path.includes('..') || path.startsWith('/')) {
    return { valid: false, state: 'error' }
  }

  // Check for .git directory
  if (path.startsWith('.git/') || path === '.git') {
    return { valid: false, state: 'disallowed' }
  }

  return { valid: true }
}

/**
 * Send postback notification to git-bridge
 */
async function sendPostback(postbackUrl, data) {
  if (!postbackUrl) {
    return
  }

  try {
    await fetchJson(postbackUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    })
    logger.debug({ postbackUrl, data }, 'Postback sent successfully')
  } catch (err) {
    logger.error(
      { err, postbackUrl, data },
      'Failed to send postback to git-bridge'
    )
    throw err
  }
}

export default {
  getDoc: expressify(getDoc),
  getSavedVers: expressify(getSavedVers),
  getSnapshot: expressify(getSnapshot),
  postSnapshot: expressify(postSnapshot),
}