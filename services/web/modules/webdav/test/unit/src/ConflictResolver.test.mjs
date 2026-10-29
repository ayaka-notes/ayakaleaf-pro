// Unit tests for ConflictResolver (vitest)
import { beforeEach, describe, expect, it, vi } from 'vitest'

const SyncStateManager = vi.hoisted(() => ({
  getProjectState: vi.fn(),
  createProjectState: vi.fn(),
  updateProjectState: vi.fn(),
  removeProjectState: vi.fn(),
}))

vi.mock('../../../app/src/SyncStateManager.mjs', () => ({
  default: SyncStateManager,
}))

// C2 (B2): resolve() now performs REAL content work via WebdavSync and only
// then clears state. WebdavSync drags in app-level handlers, so isolate it.
const WebdavSync = vi.hoisted(() => ({
  resolveConflict: vi.fn(),
}))
vi.mock('../../../app/src/WebdavSync.mjs', () => ({
  default: WebdavSync,
}))

const WebdavCredentials = vi.hoisted(() => ({
  get: vi.fn(),
}))
vi.mock('../../../app/src/WebdavCredentials.mjs', () => ({
  default: WebdavCredentials,
}))

const { default: ConflictResolver } = await import(
  '../../../app/src/ConflictResolver.mjs'
)

describe('ConflictResolver', () => {
  const userId = 'user-123'
  const projectId = 'project-123'
  const path = 'main.tex'

  beforeEach(() => {
    vi.clearAllMocks()
    WebdavCredentials.get.mockResolvedValue(null)
  })

  describe('calculateHash', () => {
    it('calculates a SHA256 hex hash for string content', async () => {
      const hash = await ConflictResolver.calculateHash('test content')
      expect(hash).toMatch(/^[a-f0-9]{64}$/)
    })

    it('returns null for empty or null content', async () => {
      expect(await ConflictResolver.calculateHash(null)).toBeNull()
      expect(await ConflictResolver.calculateHash('')).toBeNull()
    })

    it('is deterministic for identical content', async () => {
      const h1 = await ConflictResolver.calculateHash('same content')
      const h2 = await ConflictResolver.calculateHash('same content')
      expect(h1).toBe(h2)
    })

    it('differs for different content', async () => {
      const h1 = await ConflictResolver.calculateHash('a')
      const h2 = await ConflictResolver.calculateHash('b')
      expect(h1).not.toBe(h2)
    })
  })

  describe('getProjectConflictState', () => {
    it('proxies to SyncStateManager.getProjectState', async () => {
      SyncStateManager.getProjectState.mockResolvedValue({ projectId })
      const state = await ConflictResolver.getProjectConflictState(projectId)
      expect(state).toEqual({ projectId })
    })
  })

  describe('detectConflict', () => {
    it('throws when the project has no sync state', async () => {
      SyncStateManager.getProjectState.mockResolvedValue(null)
      let thrown
      try {
        await ConflictResolver.detectConflict({
          projectId,
          path,
          localHash: 'abc',
          remoteETag: 'etag-1',
        })
      } catch (err) {
        thrown = err
      }
      expect(thrown).toBeTruthy()
      expect(String(thrown.message)).toContain('Project not linked to WebDAV')
    })

    it('reports an existing conflict when lastConflict matches the path', async () => {
      SyncStateManager.getProjectState.mockResolvedValue({
        projectId,
        lastConflict: { path },
      })

      const result = await ConflictResolver.detectConflict({
        projectId,
        path,
        localHash: 'abc',
        remoteETag: 'etag-1',
      })

      expect(result.exists).toBe(true)
      expect(result.path).toBe(path)
    })

    it('flags for next-poll checking without mutating state when no conflict yet (C2: no $push accumulation)', async () => {
      SyncStateManager.getProjectState.mockResolvedValue({
        projectId,
        lastConflict: null,
      })

      const result = await ConflictResolver.detectConflict({
        projectId,
        path,
        localHash: 'abc',
        remoteETag: 'etag-1',
      })

      expect(result.exists).toBe(false)
      expect(result.shouldCheckNextPoll).toBe(true)
      expect(SyncStateManager.updateProjectState).not.toHaveBeenCalled()
    })
  })

  describe('getConflictingVersions', () => {
    it('throws a named ConflictNotFoundError when no active conflict exists', async () => {
      SyncStateManager.getProjectState.mockResolvedValue({
        projectId,
        lastConflict: null,
      })

      let thrown
      try {
        await ConflictResolver.getConflictingVersions(projectId, path)
      } catch (err) {
        thrown = err
      }
      expect(thrown?.name).toBe('ConflictNotFoundError')
    })

    it('returns local and remote versions for an active conflict', async () => {
      SyncStateManager.getProjectState.mockResolvedValue({
        projectId,
        lastConflict: {
          path,
          versions: { local: { hash: 'l' }, remote: { etag: 'r' } },
        },
      })

      const versions = await ConflictResolver.getConflictingVersions(projectId, path)
      expect(versions.local).toEqual({ hash: 'l' })
      expect(versions.remote).toEqual({ etag: 'r' })
    })
  })

  describe('resolve (C2 — real content work + state clearing)', () => {
    it('rejects an invalid choice', async () => {
      let thrown
      try {
        await ConflictResolver.resolve(userId, projectId, path, 'bogus')
      } catch (err) {
        thrown = err
      }
      expect(thrown).toBeTruthy()
      expect(String(thrown.message)).toMatch(/Invalid choice/)
    })

    it('throws ConflictNotFoundError when no active conflict exists (state or credentials)', async () => {
      SyncStateManager.getProjectState.mockResolvedValue({
        projectId,
        lastConflict: null,
      })
      WebdavCredentials.get.mockResolvedValue(null)

      let thrown
      try {
        await ConflictResolver.resolve(userId, projectId, path, 'local')
      } catch (err) {
        thrown = err
      }
      expect(thrown?.name).toBe('ConflictNotFoundError')
      expect(WebdavSync.resolveConflict).not.toHaveBeenCalled()
    })

    it('keep-local: pushes local content via WebdavSync, then clears state with $set AND $unset as separate operators', async () => {
      SyncStateManager.getProjectState.mockResolvedValue({
        projectId,
        lastConflict: { path, versions: { local: { hash: 'l' }, remote: { etag: 'r' } } },
      })
      WebdavCredentials.get.mockResolvedValue(null)
      WebdavSync.resolveConflict.mockResolvedValue({ success: true })
      SyncStateManager.updateProjectState.mockResolvedValue({})

      const result = await ConflictResolver.resolve(userId, projectId, path, 'local')

      expect(WebdavSync.resolveConflict).toHaveBeenCalledTimes(1)
      expect(WebdavSync.resolveConflict).toHaveBeenCalledWith(
        userId, projectId, path, 'keep-local'
      )
      expect(result).toEqual(
        expect.objectContaining({ success: true, choice: 'local', path })
      )
      const updateArg = SyncStateManager.updateProjectState.mock.calls[0][1]
      expect(updateArg.$set).toEqual(
        expect.objectContaining({ mergeStatus: 'clean', resolvedChoice: 'local' })
      )
      expect(updateArg.$unset).toEqual({ lastConflict: 1, conflictingPaths: 1 })
      // $unset must NOT be nested inside $set (the historical silent no-op bug)
      expect(updateArg.$set.$unset).toBeUndefined()
    })

    it('keep-remote: pulls remote content via WebdavSync', async () => {
      SyncStateManager.getProjectState.mockResolvedValue({
        projectId,
        lastConflict: { path, versions: {} },
      })
      WebdavCredentials.get.mockResolvedValue(null)
      WebdavSync.resolveConflict.mockResolvedValue({ success: true })
      SyncStateManager.updateProjectState.mockResolvedValue({})

      await ConflictResolver.resolve(userId, projectId, path, 'remote')
      expect(WebdavSync.resolveConflict).toHaveBeenCalledWith(
        userId, projectId, path, 'keep-remote'
      )
    })

    it('recognizes conflicts recorded on the user credentials doc (not only project state)', async () => {
      SyncStateManager.getProjectState.mockResolvedValue({ projectId })
      WebdavCredentials.get.mockResolvedValue({
        lastConflict: { path, projectId },
      })
      WebdavSync.resolveConflict.mockResolvedValue({ success: true })
      SyncStateManager.updateProjectState.mockResolvedValue({})

      const result = await ConflictResolver.resolve(
        userId, projectId, path, 'local'
      )
      expect(result).toMatchObject({ success: true })
    })

    it('sync failure: state is NOT cleared (no silent no-op)', async () => {
      SyncStateManager.getProjectState.mockResolvedValue({
        projectId,
        lastConflict: { path },
      })
      WebdavCredentials.get.mockResolvedValue(null)
      WebdavSync.resolveConflict.mockRejectedValueOnce(new Error('Precondition failed for main.tex'))

      let thrown
      try {
        await ConflictResolver.resolve(userId, projectId, path, 'local')
      } catch (err) {
        thrown = err
      }
      expect(thrown).toBeTruthy()
      expect(String(thrown.message)).toMatch(/main\.tex/)
      expect(SyncStateManager.updateProjectState).not.toHaveBeenCalled()
    })
  })
})
