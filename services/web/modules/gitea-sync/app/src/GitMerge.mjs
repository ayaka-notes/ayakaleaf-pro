import { normalize } from 'path/posix'
import pLimit from 'p-limit'
import { createHash } from 'crypto'
import logger from '@overleaf/logger'
import SyncStateManager from './SyncStateManager.mjs'
import api from './GiteaApiClient.mjs'
import HistoryManager from './HistoryManager.mjs'
import { GitConflictError, GitNotLinkedError, NotFoundError } from './GitSyncErrors.mjs'
import TokenManager from './TokenManager.mjs'
import LockManager from '../../../../app/src/infrastructure/LockManager.mjs'
import UpdateMerger from '../../../../app/src/Features/ThirdPartyDataStore/UpdateMerger.mjs'
import EditorController from '../../../../app/src/Features/Editor/EditorController.mjs'
import Errors from '../../../../app/src/Features/Errors/Errors.js'
import DocumentUpdaterHandler from '../../../../app/src/Features/DocumentUpdater/DocumentUpdaterHandler.mjs'

// Gitea's REST API cannot create dangling blobs, trees and commits like
// GitHub's git database API. Commits are made with the change files API
// instead, each one on a branch: on the default branch when it can move
// forward, or on a new temporary branch that is then merged through a pull
// request (see GiteaApiClient.mergeBranch).
//
// Commit entries are { path, sha, load }: sha is the git blob sha of the new
// content, or null to delete the path; load() resolves to the base64 content.

const SyncLockManager = LockManager.withTimeout(300) // 5 min

export async function doGitMerge(userId, projectId, message, claimConflictIsResolved) {
  return await SyncLockManager.promises.runWithLock(
    'gitSync', // shared with GitHub and GitLab Sync, one sync per project at a time
    projectId,
    () => doGitMergeWithoutLock(userId, projectId, message, claimConflictIsResolved)
  )
}

async function doGitMergeWithoutLock(userId, projectId, message, claimConflictIsResolved) {
  const projectSyncState = await SyncStateManager.getProjectState(projectId)
  if (!projectSyncState) throw new GitNotLinkedError(projectId)
  const {
    repoFullName,
    defaultBranchName,
    mergeStatus,
    unmergedBranchName
  } = projectSyncState

  // do nothing if conflict is not yet resolved and 'Sync' button is pushed
  // do nothing if conflict is already resolved and 'I have manually merged' button is pushed
  if (
    !claimConflictIsResolved && mergeStatus === 'conflict' ||
    claimConflictIsResolved && mergeStatus !== 'conflict'
  ) return { mergeStatus, repoFullName, unmergedBranchName }

  const token = await TokenManager.getUserToken(userId)

  await DocumentUpdaterHandler.promises.flushProjectToMongo(projectId)

  const currentVersion = await HistoryManager.latestVersion(projectId)
  const defaultBranchHead = await api.getBranchHead(token, repoFullName, defaultBranchName)

  // 'I have manually merged' is only trusted once Gitea confirms the merge,
  // otherwise the default branch would replace the unmerged OL changes
  let syncStatus = mergeStatus
  if (mergeStatus === 'conflict') {
    const merged = await api.isBranchMerged(token, repoFullName, {
      base: defaultBranchName,
      baseHead: defaultBranchHead,
      branch: unmergedBranchName,
      branchHead: projectSyncState.unmergedBranchHead,
    })
    if (!merged) {
      const branchExists = await api.getBranchHead(token, repoFullName, unmergedBranchName)
        .then(() => true, err => {
          if (err instanceof NotFoundError) return false
          throw err
        })
      if (branchExists) return { mergeStatus, repoFullName, unmergedBranchName }
      // The branch was deleted unmerged and its commits may be gone: rebuild
      // it from the Overleaf history, as after a force push
      syncStatus = 'diverged'
    }
  }

  let newUnmergedBranchName

  switch (syncStatus) {

    case 'clean':
      newUnmergedBranchName = await resolveCleanSyncState(
        token,
        userId,
        projectSyncState,
        currentVersion,
        defaultBranchHead,
        message,
      )
      break

    case 'conflict':
      newUnmergedBranchName = await resolveConflictSyncState(
        token,
        userId,
        projectSyncState,
        currentVersion,
        defaultBranchHead
      )
      break

    case 'diverged':
      newUnmergedBranchName = await resolveDetachedSyncState(
        token,
        userId,
        projectSyncState,
        currentVersion,
        defaultBranchHead,
        message,
      )
      break

    default:
      throw new Error('Bad mergeStatus')
  }

  const newMergeStatus = newUnmergedBranchName ? 'conflict' : 'clean'
  return { mergeStatus: newMergeStatus, repoFullName, unmergedBranchName: newUnmergedBranchName }
}

// ----------- clean flow
async function resolveCleanSyncState(
  token,
  userId,
  projectSyncState,
  currentVersion,
  defaultBranchHead,
  message,
) {
  const { projectId, repoFullName, defaultBranchName } = projectSyncState

  // No changes in OL
  if (currentVersion === projectSyncState.lastSyncVersion) {
    // No changes in GT too: everything is up to date
    if (projectSyncState.lastSyncCommit === defaultBranchHead) return null

    // Need to apply only GT changes
    const lastSyncCommit = defaultBranchHead
    const lastSyncVersion = await applyGitSnapshotToProject({
      token,
      userId,
      projectId,
      repoFullName,
      lastSyncCommit,
    })

    await SyncStateManager.updateProjectState(projectId, { lastSyncVersion, lastSyncCommit })
    return null
  }

  // No changes in GT: commit OL changes right on the default branch, a fast
  // forward. Otherwise commit them on a temp branch and merge it.
  const fastForward = defaultBranchHead === projectSyncState.lastSyncCommit
  const tempBranchName = fastForward ? null : generateBranchName()

  // Possible changes in OL
  const olBranchHead =
    await exportChangesToGit({
      token,
      projectId,
      repoFullName,
      lastSyncVersion: projectSyncState.lastSyncVersion,
      currentVersion,
      message,
      baseCommit: projectSyncState.lastSyncCommit,
      branch: fastForward ? defaultBranchName : tempBranchName,
      startSha: fastForward ? undefined : projectSyncState.lastSyncCommit,
    })

  if (!olBranchHead) {
    if (fastForward) {
      await SyncStateManager.updateProjectState(projectId, { lastSyncVersion: currentVersion })
      return null
    }

    const lastSyncCommit = defaultBranchHead
    const lastSyncVersion = await applyGitSnapshotToProject({
      token,
      userId,
      projectId,
      repoFullName,
      lastSyncCommit,
    })
    await SyncStateManager.updateProjectState(projectId, { lastSyncVersion, lastSyncCommit })
    return null
  }

  if (fastForward) {
    const lastSyncCommit = olBranchHead
    const lastSyncVersion = await applyGitSnapshotToProject({
      token,
      userId,
      projectId,
      repoFullName,
      lastSyncCommit,
    })
    await SyncStateManager.updateProjectState(projectId, { lastSyncVersion, lastSyncCommit })
    return null
  }

  const { mergeCommit, conflict } = await mergeTempBranch(
    token,
    repoFullName,
    defaultBranchName,
    tempBranchName
  )

  if (conflict) {
    await SyncStateManager.updateProjectState(projectId, {
      mergeStatus: 'conflict',
      lastSyncCommit: defaultBranchHead,
      unmergedBranchName: tempBranchName,
      unmergedBranchHead: olBranchHead,
      conflictVersion: currentVersion,
    })
    return tempBranchName
  } else {
    const lastSyncCommit = mergeCommit
    const lastSyncVersion = await applyGitSnapshotToProject({
      token,
      userId,
      projectId,
      repoFullName,
      lastSyncCommit,
    })
    await SyncStateManager.updateProjectState(projectId, { lastSyncVersion, lastSyncCommit })
    return null
  }
}

// ----------- conflict flow
async function resolveConflictSyncState(
  token,
  userId,
  projectSyncState,
  currentVersion,
  defaultBranchHead
) {
  const { projectId, repoFullName, defaultBranchName, conflictVersion } = projectSyncState

  // No OL changes after manual conflict resolving: pull GT changes only
  if (currentVersion === conflictVersion) {
    const lastSyncCommit = defaultBranchHead
    const lastSyncVersion = await applyGitSnapshotToProject({
      token,
      userId,
      projectId,
      repoFullName,
      lastSyncCommit,
    })

    await SyncStateManager.updateProjectState(projectId, {
      mergeStatus: 'clean',
      lastSyncVersion,
      lastSyncCommit,
      conflictVersion: null,
      unmergedBranchName: null,
      unmergedBranchHead: null
    })
    return null
  }

  // OL was changed after manual conflict resolution: need to merge
  const prevOlBranchHead = projectSyncState.unmergedBranchHead
  const tempBranchName = generateBranchName()

  const newOlBranchHead = await exportChangesToGit({
    token,
    projectId,
    repoFullName,
    lastSyncVersion: conflictVersion,
    currentVersion,
    message: '[Updates in Overleaf during conflict resolution]',
    baseCommit: prevOlBranchHead,
    branch: tempBranchName,
    startSha: prevOlBranchHead,
  })

  // Are there really were changes? (e.g.: file created, then removed: no changes)
  if (!newOlBranchHead) {
    // nothing to push to GT
    const lastSyncCommit = defaultBranchHead
    const lastSyncVersion = await applyGitSnapshotToProject({
      token,
      userId,
      projectId,
      repoFullName,
      lastSyncCommit,
    })

    await SyncStateManager.updateProjectState(projectId, {
      mergeStatus: 'clean',
      lastSyncVersion,
      lastSyncCommit,
      conflictVersion: null,
      unmergedBranchName: null,
      unmergedBranchHead: null
    })
    return null
  }

  // merge
  const { mergeCommit, conflict } = await mergeTempBranch(
    token,
    repoFullName,
    defaultBranchName,
    tempBranchName,
  )

  if (conflict) {
    // conflict must be resolved manually
    await SyncStateManager.updateProjectState(projectId, {
      mergeStatus: 'conflict',
      lastSyncCommit: defaultBranchHead,
      unmergedBranchName: tempBranchName,
      unmergedBranchHead: newOlBranchHead,
      conflictVersion: currentVersion,
    })
    return tempBranchName
  } else {
    // merge succeeded
    const lastSyncCommit = mergeCommit
    const lastSyncVersion = await applyGitSnapshotToProject({
      token,
      userId,
      projectId,
      repoFullName,
      lastSyncCommit,
    })
    await SyncStateManager.updateProjectState(projectId, {
      mergeStatus: 'clean',
      lastSyncVersion,
      lastSyncCommit,
      conflictVersion: null,
      unmergedBranchName: null,
      unmergedBranchHead: null
    })
    return null
  }
}

// ----------- detached flow
// GT repo was force pushed, lastSync commit possibly unavailable
async function resolveDetachedSyncState(
  token,
  userId,
  projectSyncState,
  currentVersion,
  defaultBranchHead,
  message,
) {
  const { projectId, repoFullName, defaultBranchName } = projectSyncState

  // No changes in OL: re-anchor
  if (currentVersion === projectSyncState.lastSyncVersion) {
    const lastSyncCommit = defaultBranchHead
    const lastSyncVersion = await applyGitSnapshotToProject({
      token,
      userId,
      projectId,
      repoFullName,
      lastSyncCommit,
    })
    await SyncStateManager.updateProjectState(projectId, { mergeStatus: 'clean', lastSyncVersion, lastSyncCommit })
    return null
  }

  // Need to compare lastSync OL version (base), current OL version (local) and GT version (remote)
  const baseSnapshot = await HistoryManager.getProjectSnapshot(projectId, projectSyncState.lastSyncVersion)
  const localSnapshot = await HistoryManager.getProjectSnapshot(projectId, currentVersion)
  const remoteBlobMap = await getGitBlobMap(token, repoFullName, defaultBranchHead)

  const {
    cleanLocalEntries,
    conflictRemoteEntries,
    conflictLocalEntries,
    conflictBaseEntries,
    hasConflicts,
    hasChanges
  } = buildDetachedSyncPlan({
    token,
    repoFullName,
    projectId,
    lastSyncVersion: projectSyncState.lastSyncVersion,
    currentVersion,
    baseSnapshot,
    localSnapshot,
    remoteBlobMap,
  })

  // were any changes introduced in GT?
  if (!hasChanges) {
    await SyncStateManager.updateProjectState(projectId, {
       mergeStatus: 'clean',
       lastSyncVersion: currentVersion,
       lastSyncCommit: defaultBranchHead
    })
    return null
  }

  if (!hasConflicts) {
    let lastSyncCommit = defaultBranchHead
    if (cleanLocalEntries.length !== 0) {
      const { commit } = await commitEntries({
        token,
        repoFullName,
        parentBlobMap: remoteBlobMap,
        entries: cleanLocalEntries,
        message,
        branch: defaultBranchName,
      })
      lastSyncCommit = commit || defaultBranchHead
    }
    const lastSyncVersion = await applyGitSnapshotToProject({
      token,
      userId,
      projectId,
      repoFullName,
      lastSyncCommit,
    })
    await SyncStateManager.updateProjectState(projectId, { mergeStatus: 'clean', lastSyncVersion, lastSyncCommit })
    return null
  }

  // Resolve potential conflict.
  // Build synthetic merge topology:
  //
  //              GT
  //             /
  // H --- B ---
  //             \
  //              OL
  //
  // merge(GT <- OL)
  //
  // B: conflicted files are restored to lastSyncVersion (merge base)
  // GT: in conflicted files remote changes after lastSyncVersion are replayed
  // OL: all changes done in Overleaf after lastSyncVersion are applied
  //
  // The base content comes from the Overleaf history, so it does not depend
  // on blobs of the force-pushed-away commits

  // default branch: --- H --- B
  const base = await commitEntries({
    token,
    repoFullName,
    parentBlobMap: remoteBlobMap,
    entries: conflictBaseEntries,
    message: '[Overleaf GitSync conflict resolution: restore last sync]',
    branch: defaultBranchName,
  })
  const baseCommit = base.commit || defaultBranchHead

  // default branch: --- H --- B --- GT
  const remoteChanges = await commitEntries({
    token,
    repoFullName,
    parentBlobMap: base.blobMap,
    entries: conflictRemoteEntries,
    message: '[Overleaf GitSync conflict resolution: replay repo changes]',
    branch: defaultBranchName,
  })
  const remoteChangesCommit = remoteChanges.commit || baseCommit

  // temp branch: --- H --- B --- OL
  const tempBranchName = generateBranchName()
  const olChanges = await commitEntries({
    token,
    repoFullName,
    parentBlobMap: base.blobMap,
    entries: [...cleanLocalEntries, ...conflictLocalEntries],
    message,
    branch: tempBranchName,
    startSha: baseCommit,
  })

  // merge: default <- temp (GT <- OL)
  const { mergeCommit, conflict } = await mergeTempBranch(
    token,
    repoFullName,
    defaultBranchName,
    tempBranchName
  )

  // auto-merge succeeded, conflicts in editable files were resolved?
  if (!conflict) {
    const lastSyncCommit = mergeCommit
    const lastSyncVersion = await applyGitSnapshotToProject({
      token,
      userId,
      projectId,
      repoFullName,
      lastSyncCommit,
    })
    await SyncStateManager.updateProjectState(projectId, { mergeStatus: 'clean', lastSyncVersion, lastSyncCommit })
    return null
  }

  // merge failed: must manually resolve conflicts
  await SyncStateManager.updateProjectState(projectId, {
    mergeStatus: 'conflict',
    lastSyncCommit: remoteChangesCommit,
    unmergedBranchName: tempBranchName,
    unmergedBranchHead: olChanges.commit,
    conflictVersion: currentVersion,
  })
  return tempBranchName
}

// ----------- Helpers
async function applyGitSnapshotToProject({ token, userId, projectId, repoFullName, lastSyncCommit }) {

  const invalidFiles = []
  const updates = []
  const deletions = []

  const currentVersion = await HistoryManager.latestVersion(projectId)
  const historySnapshot = await HistoryManager.getProjectSnapshot(projectId, currentVersion)
  const blobMap = await getGitBlobMap(token, repoFullName, lastSyncCommit)
  const blobPaths = new Set()

  for (const [path, sha] of Object.entries(blobMap)) {
    const invalid = validateFileName(path)

    if (invalid) {
      invalidFiles.push(invalid.name)
      continue
    }

    blobPaths.add(path)

    const hstSha = historySnapshot[path]?.data?.hash
    // File at path is not changed, do not touch it
    if (hstSha === sha) continue

    updates.push(path)
  }

  for (const path of Object.keys(historySnapshot)) {
    if (blobPaths.has(path)) continue
    deletions.push(path)
  }

  // TODO: do not silently ignore invalidFiles, inform user about them
  if (invalidFiles.length > 0) {
    logger.warn({ projectId, invalidFiles }, 'Invalid file paths detected at Git server')
  }
  const limit = pLimit(api.maxConcurrency)
  await Promise.all(
    updates.map(path => limit(async () => {
      const stream = await api.getBlobStream(token, repoFullName, lastSyncCommit, path)
      return UpdateMerger.promises.mergeUpdate(userId, projectId, '/' + path, stream, 'gitea')
    }))
  )
  const localLimit = pLimit(5)
  // Not UpdateMerger.deleteUpdate: it swallows every error, and the sync
  // state would move past a file that is still in the project
  await Promise.all(
    deletions.map(path => localLimit(async () => {
      try {
        await EditorController.promises.deleteEntityWithPath(projectId, '/' + path, 'gitea', userId)
      } catch (err) {
        // already gone in Overleaf
        if (!(err instanceof Errors.NotFoundError)) throw err
      }
    }))
  )

  const newVersion = await HistoryManager.latestVersion(projectId)
  if (newVersion === currentVersion) return newVersion
  // Edits made by others while pulling are not on Gitea yet: keep them
  // pending by syncing from the version before the pull
  const pullUpdates = (await HistoryManager.getUpdates(projectId))
    .filter(update => update.toV > currentVersion && update.fromV < newVersion)
  const onlyPulled = pullUpdates.at(-1)?.fromV <= currentVersion &&
    pullUpdates.every(update => update.meta.origin?.kind === 'gitea')
  return onlyPulled ? newVersion : currentVersion
}

function buildDetachedSyncPlan({
  token,
  repoFullName,
  projectId,
  lastSyncVersion,
  currentVersion,
  baseSnapshot,
  localSnapshot,
  remoteBlobMap
}) {
  const cleanLocalEntries = []
  const conflictRemoteEntries = []
  const conflictLocalEntries = []
  const conflictBaseEntries = []

  let hasConflicts = false
  let hasChanges = false

  const allPaths = new Set([
    ...Object.keys(baseSnapshot || {}),
    ...Object.keys(localSnapshot || {}),
    ...Object.keys(remoteBlobMap || {}),
  ])

  const snapshotEntry = (snapshot, version, path) => {
    const sha = getEntryHash(snapshot[path])
    if (!sha) return { path, sha: null }
    return {
      path,
      sha,
      load: () => getSnapshotFileContent(projectId, version, snapshot[path], path),
    }
  }

  for (const path of allPaths) {
    const baseHash = getEntryHash(baseSnapshot[path])
    const localHash = getEntryHash(localSnapshot[path])
    const remoteHash = remoteBlobMap[path] || null

    // OL == GT, do nothing
    if (localHash === remoteHash) continue

    if (baseHash === remoteHash) {
      // changed in OL
      hasChanges = true
      cleanLocalEntries.push(snapshotEntry(localSnapshot, currentVersion, path))
      continue
    }

    if (baseHash === localHash) {
      // changed in GT
      hasChanges = true
      continue
    }
    // conflict: changed both in GT and OL
    hasChanges = true
    hasConflicts = true

    conflictRemoteEntries.push(remoteHash
      ? { path, sha: remoteHash, load: () => api.getBlobContent(token, repoFullName, remoteHash) }
      : { path, sha: null })
    conflictLocalEntries.push(snapshotEntry(localSnapshot, currentVersion, path))
    conflictBaseEntries.push(snapshotEntry(baseSnapshot, lastSyncVersion, path))
  }
  return {
    cleanLocalEntries,
    conflictRemoteEntries,
    conflictLocalEntries,
    conflictBaseEntries,
    hasConflicts,
    hasChanges,
  }
}

// Commits the entries on top of the commit whose files are parentBlobMap:
// on branch when startSha is not given, else on a new branch at startSha.
// Resolves to { commit, blobMap }, commit is null when nothing changed.
async function commitEntries({
  token,
  repoFullName,
  parentBlobMap,
  entries,
  message,
  branch,
  startSha,
}) {
  const blobMap = { ...parentBlobMap }
  const changed = []

  for (const entry of entries) {
    if (parentBlobMap[entry.path] === (entry.sha || undefined)) continue
    if (entry.sha) blobMap[entry.path] = entry.sha
    else delete blobMap[entry.path]
    changed.push(entry)
  }

  if (changed.length === 0) return { commit: null, blobMap: parentBlobMap }

  const limit = pLimit(api.maxConcurrency)
  const files = await Promise.all(
    changed.map(entry => limit(async () => {
      // Gitea rejects the commit when the file is no longer the blob of
      // the parent commit, e.g. after a concurrent push
      const sha = parentBlobMap[entry.path]
      if (!entry.sha) return { operation: 'delete', path: entry.path, sha }
      return {
        operation: sha ? 'update' : 'create',
        path: entry.path,
        content: await entry.load(),
        ...(sha && { sha }),
      }
    }))
  )

  const commit = await api.createCommit(token, repoFullName, {
    branch,
    startSha,
    files,
    message,
  })
  return { commit, blobMap }
}

async function mergeTempBranch(
  token,
  repoFullName,
  branchName,
  tempBranchName
) {
  try {
    const mergeCommit =
      await api.mergeBranch(token, repoFullName, branchName, tempBranchName)

    try {
      await api.deleteBranch(token, repoFullName, tempBranchName)
    } catch (err) {
      logger.warn({ err, repoFullName, tempBranchName }, 'Delete temp branch failed')
    }

    return { conflict: false, mergeCommit }

  } catch (err) {
    if (err instanceof GitConflictError) {
      return { conflict: true, tempBranchName }
    }
    throw err
  }
}

// Commits the OL changes between lastSyncVersion and currentVersion on top
// of baseCommit: on branch, whose head is baseCommit, or with startSha on
// the new branch created at startSha (= baseCommit)
async function exportChangesToGit({
  token,
  projectId,
  repoFullName,
  lastSyncVersion,
  currentVersion,
  message,
  baseCommit,
  branch,
  startSha,
}) {
  const diff = await HistoryManager.getProjectFileTreeDiff(
    projectId,
    lastSyncVersion,
    currentVersion
  )

  const deletePaths = new Set()
  const upsertPaths = new Set()

  for (const item of diff) {
    const oldPath = item.pathname

    // commitEntries skips the paths missing from Gitea, such as files
    // created after the last sync
    if (item.operation === 'removed') {
      deletePaths.add(oldPath)
      continue
    }

    if (item.operation === 'renamed') {
      deletePaths.add(oldPath)
      upsertPaths.add(item.newPathname)
      continue
    }
    if (item.operation === 'added' || item.operation === 'edited') {
      upsertPaths.add(oldPath)
    }
  }
  // if a file is renamed and a new file with the old name is created,
  // then the name will be in both sets, need to exclude it from deletePaths
  for (const path of upsertPaths) {
    if (deletePaths.has(path)) deletePaths.delete(path)
  }

  // this can happen when a file is created and then removed
  if (deletePaths.size === 0 && upsertPaths.size === 0) return null

  const limit = pLimit(api.maxConcurrency)
  const upsertEntries = await Promise.all(
    [...upsertPaths].map(path =>
      limit(async () => {
        const content = await HistoryManager.getProjectFileBuffer(projectId, currentVersion, path)
        const sha = gitBlobSha(Buffer.from(content, 'base64'))
        return { path, sha, load: async () => content }
      })
    )
  )

  const deleteEntries = [...deletePaths].map(path => ({ path, sha: null }))
  const entries = [...deleteEntries, ...upsertEntries]

  const parentBlobMap = await getGitBlobMap(token, repoFullName, baseCommit)

  const { commit } = await commitEntries({
    token,
    repoFullName,
    parentBlobMap,
    entries,
    message,
    branch,
    startSha,
  })

  return commit
}

function generateBranchName() {
  const d = new Date()
  const pad = n => `${n}`.padStart(2, '0')
  return `overleaf-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}

async function getGitBlobMap(token, repoFullName, commit) {
  const blobEntries = await api.listBlobsAtCommit(token, repoFullName, commit)
  return Object.fromEntries(
    blobEntries.map(({ path, sha }) => [path, sha])
  )
}

// base64 content of a file of a history snapshot
async function getSnapshotFileContent(projectId, version, entry, path) {
  if (entry.data?.content != null) {
    return Buffer.from(entry.data.content, 'utf8').toString('base64')
  }
  return await HistoryManager.getProjectFileBuffer(projectId, version, path)
}

function getEntryHash(entry) {
  if (!entry?.data) return null
  return (
    entry.data.hash ||
    gitBlobShaFromString(entry.data.content)
  )
}

function gitBlobSha(buffer) {
  const header = Buffer.from(`blob ${buffer.length}\0`, 'utf8')
  return createHash('sha1').update(header).update(buffer).digest('hex')
}

function gitBlobShaFromString(str) {
  if (str == null) return null
  return gitBlobSha(Buffer.from(str, 'utf8'))
}

function validateFileName(name) {
  if (
    typeof name !== 'string' ||
    name.length === 0 ||
    name.includes('\0')
  ) return { name }

  const normalized = normalize(name)

  if (
    normalized !== name ||
    normalized.startsWith('/') ||
    normalized.startsWith('../')
  ) return { name }

  return null
}
