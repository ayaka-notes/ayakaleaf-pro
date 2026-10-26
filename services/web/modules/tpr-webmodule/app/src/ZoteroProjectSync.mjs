import fs from 'node:fs'
import logger from '@overleaf/logger'
import EditorController from '../../../../app/src/Features/Editor/EditorController.mjs'
import DocumentUpdaterHandler from '../../../../app/src/Features/DocumentUpdater/DocumentUpdaterHandler.mjs'
import ProjectEntityHandler from '../../../../app/src/Features/Project/ProjectEntityHandler.mjs'
import FileWriter from '../../../../app/src/infrastructure/FileWriter.mjs'
import ZoteroApiClient from './ZoteroApiClient.mjs'

// Project element paths are absolute (with a leading slash), e.g. "/refs.bib".
const DEFAULT_BIB_NAME = '/references.bib'

async function listBibDocs(projectId) {
  const docs = await ProjectEntityHandler.promises.getAllDocs(projectId)
  return Object.entries(docs)
    .filter(([path]) => path.toLowerCase().endsWith('.bib'))
    .map(([path, doc]) => ({
      path,
      docId: String(doc._id),
      lines: doc.lines || [],
    }))
}

/**
 * Prefer the live copy from document-updater, which may be ahead of docstore
 * when somebody is editing. Documents that were never opened in an editor are
 * not loaded there yet and answer 500, so fall back to the docstore snapshot.
 */
async function readLines(projectId, doc) {
  try {
    const { lines } = await DocumentUpdaterHandler.promises.getDocument(
      projectId,
      doc.docId
    )
    return lines
  } catch (err) {
    return doc.lines || []
  }
}

async function writeLines(projectId, path, lines, userId, source) {
  await EditorController.promises.upsertDocWithPath(
    projectId,
    path,
    lines,
    source,
    userId
  )
}

function normaliseBibName(name) {
  let base = (name || DEFAULT_BIB_NAME).trim() || DEFAULT_BIB_NAME
  base = base.replace(/^\/+/, '')
  if (!base.toLowerCase().endsWith('.bib')) {
    base = `${base}.bib`
  }
  return `/${base}`
}

function libraryArgOf(libraryId) {
  return !libraryId || libraryId === 'user' ? null : libraryId
}

async function writeFile(
  projectId,
  path,
  content,
  linkedFileData,
  userId,
  source
) {
  const fsPath = await FileWriter.promises.writeContentToDisk(projectId, content)
  try {
    await EditorController.promises.upsertFileWithPath(
      projectId,
      path,
      fsPath,
      linkedFileData,
      source,
      userId
    )
  } finally {
    await fs.promises.unlink(fsPath).catch(() => {})
  }
}

/**
 * Plain BibTeX, no bookkeeping comments: the sync state lives in
 * linkedFileData (item keys + versions), not in the file itself.
 */
function renderBibtex(entries) {
  return (
    entries
      .map(item => (item.bibtex || '').trim())
      .filter(Boolean)
      .join('\n\n') + '\n'
  )
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function appendEntries(lines, entries) {
  const out = [...lines]
  while (out.length && out[out.length - 1].trim() === '') {
    out.pop()
  }
  for (const entry of entries) {
    if (out.length) {
      out.push('')
    }
    out.push(...entry.trim().split('\n'))
  }
  if (out.length) {
    out.push('')
  }
  return out
}

async function resolveTargetPath(projectId, requestedPath) {
  const docs = await listBibDocs(projectId)
  if (requestedPath) {
    const match = docs.find(doc => doc.path === requestedPath)
    return { path: requestedPath, doc: match || null }
  }
  if (docs.length) {
    return { path: docs[0].path, doc: docs[0] }
  }
  return { path: DEFAULT_BIB_NAME, doc: null }
}

/**
 * Add the given Zotero items to a project .bib document, returning the citation
 * keys so the caller can put them into \cite{...}. Entries already present are
 * detected by citation key, so the file carries no Zotero metadata.
 */
async function citeItems(
  projectId,
  userId,
  { libraryId, collectionKey = null, itemKeys, targetPath }
) {
  if (!Array.isArray(itemKeys) || itemKeys.length === 0) {
    throw new Error('no items given')
  }

  const target = await resolveTargetPath(projectId, targetPath)
  const lines = target.doc ? await readLines(projectId, target.doc) : []
  const text = lines.join('\n')

  const fetched = await ZoteroApiClient.getItemsBibtex(userId, {
    libraryId,
    itemKeys,
  })

  const entries = []
  const pending = []
  for (const item of fetched) {
    if (!item.citationKey) {
      continue
    }
    const present = new RegExp(
      `@\\w+\\s*\\{\\s*${escapeRegExp(item.citationKey)}\\s*,`
    ).test(text)
    entries.push({
      itemKey: item.itemKey,
      citationKey: item.citationKey,
      added: !present,
    })
    if (!present && item.bibtex) {
      pending.push(item.bibtex)
    }
  }

  if (pending.length) {
    await writeLines(
      projectId,
      target.path,
      appendEntries(lines, pending),
      userId,
      'zotero-cite'
    )
  }

  return {
    path: target.path,
    entries: entries.filter(entry => entry.citationKey),
  }
}

/**
 * Import the selected items as a linked .bib file. The file tree shows the
 * "linked" badge, and linkedFileData keeps everything needed for a later sync
 * (library, collection, item keys and their versions).
 */
async function importSelected(
  projectId,
  userId,
  { libraryId, collectionKey = null, itemKeys, name, mirror = false }
) {
  const keys = [...new Set(itemKeys || [])]
  if (!keys.length) {
    throw new Error('no items given')
  }

  const library = libraryId || 'user'
  const libraryArg = libraryArgOf(library)
  const meta = await ZoteroApiClient.getItems(userId, {
    libraryId: libraryArg,
    itemKeys: keys,
  })
  const versions = Object.fromEntries(
    meta.map(item => [item.key, item.version])
  )
  const fetched = await ZoteroApiClient.getItemsBibtex(userId, {
    libraryId: libraryArg,
    itemKeys: keys,
  })
  const storedKeys = fetched.filter(item => item.bibtex).map(item => item.itemKey)
  const path = normaliseBibName(name || 'zotero.bib')

  await writeFile(
    projectId,
    path,
    renderBibtex(fetched),
    {
      provider: 'zotero',
      library,
      collection: collectionKey || null,
      item_keys: storedKeys,
      item_versions: versions,
      mirror: Boolean(mirror),
      importedAt: new Date().toISOString(),
      importer_id: String(userId),
    },
    userId,
    'zotero-import'
  )

  return {
    path,
    imported: storedKeys.length,
    skipped: keys.length - storedKeys.length,
    total: keys.length,
  }
}

/**
 * Incremental sync of the Zotero linked files in the project: only files that
 * belong to an imported collection are touched, and only when a version moved,
 * an item left the collection, or (mirror files) an item was added.
 */
async function syncProject(projectId, userId) {
  const files = await ProjectEntityHandler.promises.getAllFiles(projectId)
  const summary = { files: [], added: 0, updated: 0, removed: 0 }

  for (const [filePath, file] of Object.entries(files)) {
    const data = file.linkedFileData
    if (!data || data.provider !== 'zotero' || !Array.isArray(data.item_keys)) {
      continue
    }

    const library = data.library || 'user'
    const libraryArg = libraryArgOf(library)
    const storedVersions = { ...(data.item_versions || {}) }
    const versions = { ...storedVersions }
    let itemKeys = [...data.item_keys]
    let added = 0
    let removed = 0

    if (data.mirror && data.collection) {
      const items = await ZoteroApiClient.listAllItems(userId, {
        libraryId: libraryArg,
        collectionKey: data.collection,
      })
      const remote = new Map(items.map(item => [item.key, item]))
      for (const item of items) {
        if (!itemKeys.includes(item.key)) {
          itemKeys.push(item.key)
          added++
        }
        versions[item.key] = item.version
      }
      itemKeys = itemKeys.filter(key => {
        if (remote.has(key)) {
          return true
        }
        removed++
        return false
      })
    } else {
      const meta = await ZoteroApiClient.getItems(userId, {
        libraryId: libraryArg,
        itemKeys,
      })
      const found = new Set(meta.map(item => item.key))
      for (const item of meta) {
        versions[item.key] = item.version
      }
      itemKeys = itemKeys.filter(key => {
        if (found.has(key)) {
          return true
        }
        removed++
        return false
      })
    }

    const changed = itemKeys.filter(
      key =>
        storedVersions[key] !== undefined &&
        versions[key] !== storedVersions[key]
    )
    if (!added && !removed && !changed.length) {
      continue
    }

    const fetched = await ZoteroApiClient.getItemsBibtex(userId, {
      libraryId: libraryArg,
      itemKeys,
    })

    await writeFile(
      projectId,
      filePath,
      renderBibtex(fetched),
      {
        ...data,
        library,
        item_keys: itemKeys,
        item_versions: versions,
        importedAt: new Date().toISOString(),
        importer_id: String(userId),
      },
      userId,
      'zotero-sync'
    )

    summary.files.push({
      path: filePath,
      added,
      updated: changed.length,
      removed,
    })
    summary.added += added
    summary.updated += changed.length
    summary.removed += removed
  }

  logger.debug(
    { projectId, files: summary.files.length },
    'zotero sync finished'
  )

  return summary
}

export default {
  listBibDocs,
  citeItems,
  importSelected,
  syncProject,
}
