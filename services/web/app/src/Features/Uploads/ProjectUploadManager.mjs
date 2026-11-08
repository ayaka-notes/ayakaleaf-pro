import Path from 'node:path'
import fs from 'node:fs'
import { callbackify } from 'node:util'
import ArchiveManager from './ArchiveManager.mjs'
import { Doc } from '../../models/Doc.mjs'
import DocstoreManager from '../Docstore/DocstoreManager.mjs'
import DocumentHelper from '../Documents/DocumentHelper.mjs'
import DocumentUpdaterHandler from '../DocumentUpdater/DocumentUpdaterHandler.mjs'
import FileStoreHandler from '../FileStore/FileStoreHandler.mjs'
import FileSystemImportManager from './FileSystemImportManager.mjs'
import ReviewStateManager from '../Reviews/ReviewStateManager.mjs'
import ProjectCreationHandler from '../Project/ProjectCreationHandler.mjs'
import ProjectEntityMongoUpdateHandler from '../Project/ProjectEntityMongoUpdateHandler.mjs'
import ProjectRootDocManager from '../Project/ProjectRootDocManager.mjs'
import ProjectDetailsHandler from '../Project/ProjectDetailsHandler.mjs'
import ProjectDeleter from '../Project/ProjectDeleter.mjs'
import { DeletedProjectReasons } from '../Project/DeletedProjectReasons.mjs'
import TpdsProjectFlusher from '../ThirdPartyDataStore/TpdsProjectFlusher.mjs'
import logger from '@overleaf/logger'
import OError from '@overleaf/o-error'

// Must match REVIEW_JSON_NAME in Features/Downloads/ProjectZipStreamManager.mjs
// and Features/Reviews/ReviewStateManager.mjs (duplicated rather than imported:
// those modules' dependency graphs drag in mongoose models, which breaks unit
// tests that mock this one).
const REVIEW_JSON_NAME = 'overleaf-comments-and-changes.json'

export default {
  createProjectFromZipArchive: callbackify(createProjectFromZipArchive),
  createProjectFromZipArchiveWithName: callbackify(
    createProjectFromZipArchiveWithName
  ),
  promises: {
    createProjectFromZipArchive,
    createProjectFromZipArchiveWithName,
  },
}

async function createProjectFromZipArchive(ownerId, defaultName, zipPath) {
  const contentsPath = await _extractZip(zipPath)
  try {
    const { path, content } =
      await ProjectRootDocManager.promises.findRootDocFileFromDirectory(
        contentsPath
      )

    const projectName =
      DocumentHelper.getTitleFromTexContent(content || '') || defaultName
    const uniqueName = await _generateUniqueName(ownerId, projectName)
    const project = await ProjectCreationHandler.promises.createBlankProject(
      ownerId,
      uniqueName
    )
    try {
      await _initializeProjectWithZipContents(ownerId, project, contentsPath)

      if (path) {
        await ProjectRootDocManager.promises.setRootDocFromName(
          project._id,
          path
        )
      }
    } catch (err) {
      // no need to wait for the cleanup here
      ProjectDeleter.promises
        .deleteProject(project._id, {
          deletedReason: DeletedProjectReasons.ZIP_IMPORT_FAILURE,
        })
        .catch(err =>
          logger.error(
            { err, projectId: project._id },
            'there was an error cleaning up project after importing a zip failed'
          )
        )
      throw err
    }
    return project
  } finally {
    await fs.promises.rm(contentsPath, { recursive: true, force: true })
  }
}

async function createProjectFromZipArchiveWithName(
  ownerId,
  proposedName,
  zipPath,
  attributes = {}
) {
  const contentsPath = await _extractZip(zipPath)
  try {
    const uniqueName = await _generateUniqueName(ownerId, proposedName)
    const project = await ProjectCreationHandler.promises.createBlankProject(
      ownerId,
      uniqueName,
      attributes
    )

    try {
      const { fileEntries, docEntries } =
        await _initializeProjectWithZipContents(ownerId, project, contentsPath)
      const result =
        await ProjectRootDocManager.promises.setRootDocAutomatically(
          project._id
        )
      if (result) project.rootDoc_id = result.rootDocId
      return { fileEntries, docEntries, project }
    } catch (err) {
      // no need to wait for the cleanup here
      ProjectDeleter.promises
        .deleteProject(project._id, {
          deletedReason: DeletedProjectReasons.ZIP_IMPORT_FAILURE,
        })
        .catch(err =>
          logger.error(
            { err, projectId: project._id },
            'there was an error cleaning up project after importing a zip failed'
          )
        )
      throw err
    }
  } finally {
    await fs.promises.rm(contentsPath, { recursive: true, force: true })
  }
}

async function _extractZip(zipPath) {
  const destination = Path.join(
    Path.dirname(zipPath),
    `${Path.basename(zipPath, '.zip')}-${Date.now()}`
  )
  try {
    await ArchiveManager.promises.extractZipArchive(zipPath, destination)
  } catch (error) {
    logger.debug({ zipPath, error }, 'error extracting from zip archive')
    await fs.promises.rm(destination, { recursive: true, force: true })
    throw error
  }
  return destination
}

async function _generateUniqueName(ownerId, originalName) {
  const fixedName = ProjectDetailsHandler.fixProjectName(originalName)
  const uniqueName = await ProjectDetailsHandler.promises.generateUniqueName(
    ownerId,
    fixedName
  )
  return uniqueName
}

async function _initializeProjectWithZipContents(
  ownerId,
  project,
  contentsPath
) {
  const topLevelDir =
    await ArchiveManager.promises.findTopLevelDirectory(contentsPath)
  const importEntries =
    await FileSystemImportManager.promises.importDir(topLevelDir)
  const { fileEntries, docEntries } = await _createEntriesFromImports(
    project,
    importEntries
  )
  const projectVersion =
    await ProjectEntityMongoUpdateHandler.promises.createNewFolderStructure(
      project._id,
      docEntries,
      fileEntries
    )
  await _notifyDocumentUpdater(project, ownerId, {
    newFiles: fileEntries,
    newDocs: docEntries,
    newProject: { version: projectVersion },
  })
  await TpdsProjectFlusher.promises.flushProjectToTpds(project._id)
  // Reconstitute the review state (comments + tracked changes) bundled in the
  // zip, if present. Never allowed to break the import itself.
  await _restoreReviewState(project, docEntries, topLevelDir)
  return { fileEntries, docEntries }
}

async function _restoreReviewState(project, docEntries, topLevelDir) {
  const bundlePath = Path.join(topLevelDir, REVIEW_JSON_NAME)
  let state
  try {
    state = JSON.parse(await fs.promises.readFile(bundlePath, 'utf8'))
  } catch (err) {
    if (err?.code === 'ENOENT') return // no bundle in this zip — nothing to do
    logger.warn(
      { err, projectId: project._id },
      'could not read review state bundle from import zip; skipping restore'
    )
    return
  }
  const docs = docEntries.map(entry => ({
    docId: entry.doc?._id,
    text: entry.docLines ?? '',
  }))
  try {
    await ReviewStateManager.promises.restoreReviewState({ project, docs, state })
  } catch (err) {
    logger.error(
      { err, projectId: project._id },
      'failed to restore review state from import zip (import itself succeeded)'
    )
  }
}

/**
 * Create project docs and files using concurrent workers.
 * Returns the created entries grouped by type, in the correct order.
 */
async function _createEntriesFromImports(project, importEntries) {
  // A project zip bundles its review state (overleaf-comments-and-changes.json:
  // comment threads + tracked changes). It is machine-generated metadata, not
  // project content: it must never be carried over as a file — most importantly
  // when a project becomes a template (a template must have no comments or
  // tracked changes). _restoreReviewState reconstitutes the state instead.
  const keptEntries = importEntries.filter(
    entry => Path.basename(entry.projectPath) !== REVIEW_JSON_NAME
  )
  if (keptEntries.length !== importEntries.length) {
    logger.info(
      { projectId: project._id, skipped: importEntries.length - keptEntries.length },
      `skipping review-state bundle file on import (${REVIEW_JSON_NAME})`
    )
  }

  const createdEntries = new Array(keptEntries.length)
  let nextIndex = 0
  let firstError

  async function worker() {
    while (firstError == null) {
      const currentIndex = nextIndex
      nextIndex++

      if (currentIndex >= keptEntries.length) {
        return
      }

      try {
        createdEntries[currentIndex] = await _createEntryFromImport(
          project,
          keptEntries[currentIndex]
        )
      } catch (error) {
        firstError = firstError ?? error
        return
      }
    }
  }

  await Promise.allSettled(
    Array.from({ length: Math.min(5, keptEntries.length) }, () => worker())
  )

  if (firstError != null) {
    throw firstError
  }

  const fileEntries = []
  const docEntries = []

  for (const createdEntry of createdEntries) {
    switch (createdEntry.type) {
      case 'doc': {
        docEntries.push(createdEntry.entry)
        break
      }
      case 'file': {
        fileEntries.push(createdEntry.entry)
        break
      }
    }
  }

  return { fileEntries, docEntries }
}

async function _createEntryFromImport(project, importEntry) {
  switch (importEntry.type) {
    case 'doc': {
      return {
        type: 'doc',
        entry: await _createDoc(
          project,
          importEntry.projectPath,
          importEntry.lines
        ),
      }
    }
    case 'file': {
      return {
        type: 'file',
        entry: await _createFile(
          project,
          importEntry.projectPath,
          importEntry.fsPath
        ),
      }
    }
    default: {
      throw new Error(`Invalid import type: ${importEntry.type}`)
    }
  }
}

async function _createDoc(project, projectPath, docLines) {
  const projectId = project._id
  const docName = Path.basename(projectPath)
  const doc = new Doc({ name: docName })
  await DocstoreManager.promises.updateDoc(
    projectId.toString(),
    doc._id.toString(),
    docLines,
    0,
    {}
  )
  return { doc, path: projectPath, docLines: docLines.join('\n') }
}

async function _createFile(project, projectPath, fsPath) {
  const projectId = project._id
  const historyId = project.overleaf?.history?.id
  if (!historyId) {
    throw new OError('missing history id')
  }
  const fileName = Path.basename(projectPath)
  const { createdBlob, fileRef } =
    await FileStoreHandler.promises.uploadFileFromDiskWithHistoryId(
      projectId,
      historyId,
      { name: fileName },
      fsPath
    )
  return { createdBlob, file: fileRef, path: projectPath }
}

async function _notifyDocumentUpdater(project, userId, changes) {
  const projectHistoryId =
    project.overleaf && project.overleaf.history && project.overleaf.history.id
  await DocumentUpdaterHandler.promises.updateProjectStructure(
    project._id,
    projectHistoryId,
    userId,
    changes,
    null
  )
}
