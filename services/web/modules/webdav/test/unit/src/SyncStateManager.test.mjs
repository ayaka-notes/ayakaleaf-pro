import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../app/models/webdavSyncProjectStates.mjs', () => {
  const state = {
    findOne: vi.fn(),
    findOneAndUpdate: vi.fn(),
    updateOne: vi.fn(),
    deleteMany: vi.fn(),
    create: vi.fn(),
  }
  return { WebdavSyncProjectStates: state }
})

const { WebdavSyncProjectStates } = await import(
  '../../../app/models/webdavSyncProjectStates.mjs'
)
const { default: SyncStateManager } = await import(
  '../../../app/src/SyncStateManager.mjs'
)

describe('SyncStateManager', () => {
  const projectId = 'project-123'

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('getProjectState', () => {
    it('returns the project state document via a lean query', async () => {
      const mockState = { projectId, lastSync: new Date() }
      WebdavSyncProjectStates.findOne.mockReturnValue({
        lean: vi.fn().mockResolvedValue(mockState),
      })

      const result = await SyncStateManager.getProjectState(projectId)

      expect(result).toEqual(mockState)
      expect(WebdavSyncProjectStates.findOne).toHaveBeenCalled()
    })

    it('returns null when no state exists', async () => {
      WebdavSyncProjectStates.findOne.mockReturnValue({
        lean: vi.fn().mockResolvedValue(null),
      })

      const result = await SyncStateManager.getProjectState('missing')
      expect(result).toBeNull()
    })
  })

  describe('createProjectState', () => {
    it('creates a new project state document', async () => {
      const createdDoc = { projectId, lastSync: null }
      WebdavSyncProjectStates.findOneAndUpdate.mockReturnValue({
        lean: vi.fn().mockResolvedValue(createdDoc),
      })

      const result = await SyncStateManager.createProjectState(projectId, {
        connected: true,
      })

      expect(result).toEqual(createdDoc)
      expect(WebdavSyncProjectStates.findOneAndUpdate).toHaveBeenCalledWith(
        { projectId },
        expect.any(Object),
        expect.any(Object)
      )
    })
  })

  describe('updateProjectState', () => {
    it('updates project state with $set', async () => {
      WebdavSyncProjectStates.updateOne.mockResolvedValue({
        matchedCount: 1,
        modifiedCount: 1,
      })

      const result = await SyncStateManager.updateProjectState(projectId, {
        lastSync: new Date(),
      })

      expect(WebdavSyncProjectStates.updateOne).toHaveBeenCalledWith(
        { projectId },
        expect.objectContaining({ $set: expect.any(Object) })
      )
      expect(result.matchedCount).toBe(1)
    })

    it('returns the update result', async () => {
      const mockResult = { matchedCount: 0, modifiedCount: 0 }
      WebdavSyncProjectStates.updateOne.mockResolvedValue(mockResult)

      const result = await SyncStateManager.updateProjectState(projectId, {})
      expect(result).toEqual(mockResult)
    })
  })

  describe('removeProjectState', () => {
    it('deletes project state', async () => {
      WebdavSyncProjectStates.deleteMany.mockResolvedValue({ deletedCount: 1 })

      await SyncStateManager.removeProjectState(projectId)

      expect(WebdavSyncProjectStates.deleteMany).toHaveBeenCalledWith({ projectId })
    })
  })
})
