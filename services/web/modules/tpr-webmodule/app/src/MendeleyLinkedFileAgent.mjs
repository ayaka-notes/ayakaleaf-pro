import logger from '@overleaf/logger'
import { callbackify } from '@overleaf/promise-utils'
import LinkedFilesHandler from '../../../../app/src/Features/LinkedFiles/LinkedFilesHandler.mjs'
import LinkedFilesErrors from '../../../../app/src/Features/LinkedFiles/LinkedFilesErrors.mjs'
import MendeleyApiClient from './MendeleyApiClient.mjs'
import {
  MendeleyForbiddenError,
  MendeleyExpiredError,
  MendeleyAccountNotLinkedError,
} from './MendeleyApiClient.mjs'

const {
  AccessDeniedError,
  NotOriginalImporterError,
  RemoteServiceError,
} = LinkedFilesErrors

/**
 * Create a linked .bib file from Mendeley (either My Library or a group).
 *
 * linkedFileData shape:
 *   {
 *     provider: 'mendeley'
 *     group_id?: string
 *     importedAt: Date | string
 *     importer_id?: string
 *   }
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
    'creating Mendeley linked file'
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

/** Refresh an existing Mendeley linked .bib file. */
async function refreshLinkedFile(
  projectId,
  linkedFileData,
  name,
  parentFolderId,
  userId
) {
  logger.debug(
    { projectId, userId, groupId: linkedFileData.group_id },
    'refreshing Mendeley linked file'
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
      return await MendeleyApiClient.getGroupLibraryBibtex(
        userId,
        linkedFileData.group_id
      )
    } else {
      return await MendeleyApiClient.getUserLibraryBibtex(userId)
    }
  } catch (err) {
    if (err instanceof MendeleyExpiredError) {
      throw new AccessDeniedError('Mendeley token expired').withCause(err)
    }
    if (err instanceof MendeleyForbiddenError) {
      throw new AccessDeniedError('Mendeley access denied').withCause(err)
    }
    if (err instanceof MendeleyAccountNotLinkedError) {
      throw new AccessDeniedError('Mendeley account not linked').withCause(err)
    }
    throw new RemoteServiceError('Mendeley API error').withCause(err)
  }
}

function _sanitizeData(data) {
  return {
    provider: 'mendeley',
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
  promises: { createLinkedFile, refreshLinkedFile },
}
