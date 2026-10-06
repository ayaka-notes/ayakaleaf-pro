import logger from '@overleaf/logger'
import { callbackify } from '@overleaf/promise-utils'
import LinkedFilesHandler from '../../../../app/src/Features/LinkedFiles/LinkedFilesHandler.mjs'
import LinkedFilesErrors from '../../../../app/src/Features/LinkedFiles/LinkedFilesErrors.mjs'
import ZoteroApiClient from './ZoteroApiClient.mjs'
import { ZoteroForbiddenError, ZoteroAccountNotLinkedError } from './ZoteroApiClient.mjs'

const {
  AccessDeniedError,
  NotOriginalImporterError,
  RemoteServiceError,
} = LinkedFilesErrors

/**
 * Create a linked .bib file from Zotero (either My Library or a Group Library).
 *
 * linkedFileData shape:
 *   {
 *     provider: 'zotero'
 *     group_id?: string
 *     importedAt: Date | string
 *     importer_id?: string
 *   }
 *
 *  - If group_id is present, export that group's library.
 *  - Otherwise, export the user's personal library ("My Library").
 */
async function createLinkedFile(
  projectId,
  linkedFileData,
  name,
  parentFolderId,
  userId
) {
  logger.debug(
    { projectId, userId, groupId: linkedFileData.group_id },
    'creating Zotero linked file'
  )

  linkedFileData.importer_id = userId

  const bibtex = await _getBibtex(linkedFileData)

  const file = await LinkedFilesHandler.promises.importContent(
    projectId,
    bibtex,
    _sanitizeData(linkedFileData),
    name,
    parentFolderId,
    userId
  )
  return file._id
}

/**
 * Refresh an existing Zotero linked .bib file.
 */
async function refreshLinkedFile(
  projectId,
  linkedFileData,
  name,
  parentFolderId,
  userId
) {
  logger.debug(
    { projectId, userId, groupId: linkedFileData.group_id },
    'refreshing Zotero linked file'
  )

  // Refresh runs on the importer's credentials, so only they can trigger it.
  if (String(linkedFileData.importer_id) !== String(userId)) {
    throw new NotOriginalImporterError('not the original importer')
  }

  const bibtex = await _getBibtex(linkedFileData)

  const file = await LinkedFilesHandler.promises.importContent(
    projectId,
    bibtex,
    _sanitizeData(linkedFileData),
    name,
    parentFolderId,
    userId
  )
  return file._id
}

async function _getBibtex(linkedFileData) {
  const userId = linkedFileData.importer_id
  try {
    if (linkedFileData.group_id) {
      return await ZoteroApiClient.getGroupLibraryBibtex(
        userId,
        linkedFileData.group_id
      )
    } else {
      return await ZoteroApiClient.getUserLibraryBibtex(userId)
    }
  } catch (err) {
    if (err instanceof ZoteroForbiddenError) {
      throw new AccessDeniedError('Zotero access denied').withCause(err)
    }
    if (err instanceof ZoteroAccountNotLinkedError) {
      throw new AccessDeniedError('Zotero account not linked').withCause(err)
    }
    throw new RemoteServiceError('Zotero API error').withCause(err)
  }
}

function _sanitizeData(data) {
  return {
    provider: 'zotero',
    ...(data.group_id && {
      group_id: data.group_id,
    }),
    importedAt: data.importedAt,
    ...(data.importer_id && {
      importer_id: String(data.importer_id),
    }),
  }
}

export default {
  createLinkedFile: callbackify(createLinkedFile),
  refreshLinkedFile: callbackify(refreshLinkedFile),
  promises: { createLinkedFile, refreshLinkedFile }
}
