import logger from '@overleaf/logger'
import { callbackify } from '@overleaf/promise-utils'
import UserGetter from '../../../../app/src/Features/User/UserGetter.mjs'
import {
   NotFoundError,
   ServiceNotConfiguredError,
   ForbiddenError
} from '../../../../app/src/Features/Errors/Errors.js'
import LinkedFilesHandler from '../../../../app/src/Features/LinkedFiles/LinkedFilesHandler.mjs'
import LinkedFilesErrors from '../../../../app/src/Features/LinkedFiles/LinkedFilesErrors.mjs'
import ZoteroApiClient from './ZoteroApiClient.mjs'

/**
 * Create a linked .bib file from Zotero (either My Library or a Group Library).
 *
 * linkedFileData shape:
 *   {
 *     provider: 'zotero'
 *     group_id: string | null
 *     collection_key?: string | null
 *     importedAt: Date | string
 *     importer_id: string
 *     importer_name: string
 *     format: 'bibtex' || 'biblatex'
 *   }
 *
 *  - If group_id is present, export that group's library.
 *  - Otherwise, export the user's personal library ("My Library").
 *  - If collection_key is present, export only items in that collection.
 *  - The reserved collection_key "publications" exports My Publications.
 *  - Trash is excluded from all exports.
 */
async function createLinkedFile(
  projectId,
  linkedFileData,
  name,
  parentFolderId,
  userId
) {

  linkedFileData.importer_id = userId
  linkedFileData.importer_name = await _getUserName(userId) || 'Unknown'

  logger.debug(
    { projectId, userId, linkedFileData },
    'creating Zotero linked file'
  )

  return _importLinkedFile(projectId, linkedFileData, name, parentFolderId, userId)
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
    { projectId, userId, linkedFileData },
    'refreshing Zotero linked file'
  )

  // Preserve the old name if the importer is unavailable. Persist the refreshed
  // name with the bibliography through importContent(), not a separate write.
  const userName = await _getUserName(linkedFileData.importer_id)
  if (userName) {
    linkedFileData.importer_name = userName
  }

  return _importLinkedFile(projectId, linkedFileData, name, parentFolderId, userId)
}

async function _importLinkedFile(projectId, linkedFileData, name, parentFolderId, userId) {
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
    return await ZoteroApiClient.getLibraryBibtex(
      userId,
      linkedFileData.group_id,  // == null for main library
      linkedFileData.format || 'bibtex',
      linkedFileData.collection_key
    )
  } catch (err) {

    if (err instanceof ForbiddenError) {
      logger.debug({ linkedFileData, err }, 'Zotero access denied')
      throw new LinkedFilesErrors.AccessDeniedError('Zotero access denied').withCause(err)
    }
    if (err instanceof ServiceNotConfiguredError) {
      logger.debug({ userId: linkedFileData.importer_id, err }, 'Zotero account not linked')
      throw new LinkedFilesErrors.AccessDeniedError('Zotero account not linked').withCause(err)
    }
    if (err instanceof NotFoundError) {
      logger.debug({ group: linkedFileData.group_id, collection: linkedFileData.collection_key, err }, 'Zotero library or collection is not found')
      throw new LinkedFilesErrors.SourceFileNotFoundError('Zotero library or collection is not found').withCause(err)
    }
    logger.error({ linkedFileData, err }, 'failed to retrieve bib file from Zotero')
    throw new LinkedFilesErrors.RemoteServiceError('Error retrieving bib file from Zotero').withCause(err)
  }
}

function _sanitizeData(data) {
  return {
    provider: 'zotero',
    group_id: data.group_id ?? null,
    ...(data.collection_key && {
      collection_key: data.collection_key,
    }),
    importedAt: data.importedAt,
    ...(data.importer_id && {
      importer_id: data.importer_id,
    }),
    importer_name: data.importer_name || 'Unknown',
    format: (data.format === 'biblatex') ? 'biblatex' : 'bibtex'
  }
}

async function _getUserName(userId) {
  let user = null
  try {
    user = await UserGetter.promises.getUser(userId, {'email': 1, 'first_name': 1, 'last_name': 1})
  }
  catch (err) {
    logger.error({ userId, err }, 'failed to get user info')
  }
  if (!user) return null

  const { email, first_name, last_name } = user
  const name = (first_name || last_name) ?
    [first_name, last_name].filter(n => n != null).join(' ') : email
  return name
}

export default {
  createLinkedFile: callbackify(createLinkedFile),
  refreshLinkedFile: callbackify(refreshLinkedFile),
  promises: { createLinkedFile, refreshLinkedFile }
}
