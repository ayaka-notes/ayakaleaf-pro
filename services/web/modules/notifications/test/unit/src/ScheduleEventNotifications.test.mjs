import { describe, it, expect, vi, beforeEach } from 'vitest'

// Generic event scheduler (ScheduleEventNotifications.mjs):
// - resolves recipients per event type
// - drops muted / event-off recipients
// - coalesces via upsert keyed on (recipient, project?, eventKey)

function makeDb() {
  const updateOne = vi.fn().mockResolvedValue({ upsertedCount: 1 })
  return {
    db: {
      notificationsPreferences: {
        findOne: vi.fn().mockResolvedValue(null),
      },
      projects: {
        findOne: vi.fn(),
      },
      emailNotifications: { updateOne },
    },
    updateOne,
  }
}

function mockDeps(db) {
  vi.doMock('../../../../../app/src/infrastructure/mongodb.mjs', () => ({
    db: db.db,
    connectionPromise: Promise.resolve(),
    ObjectId: class ObjectId {
      constructor(s) {
        this.s = s
      }
      toString() {
        return this.s
      }
    },
  }))
}

const PROJECT = {
  _id: 'proj-1',
  owner_ref: 'owner-1',
  collaberator_refs: ['collab-1'],
  readOnly_refs: ['viewer-1'],
  name: 'Test Project',
}

describe('scheduleEventNotification', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('notifies all members for project-members events (projectExpiring)', async () => {
    const db = makeDb()
    db.db.projects.findOne.mockResolvedValue(PROJECT)
    mockDeps(db)
    const { scheduleEventNotification } = await import(
      '../../../app/src/ScheduleEventNotifications.mjs'
    )
    const result = await scheduleEventNotification('projectExpiring', {
      projectId: 'proj-1',
    })
    expect(result.scheduled).toBe(3) // owner + collab + viewer
  })

  it('excludes the actor for minus-actor events (projectRenamed)', async () => {
    const db = makeDb()
    db.db.projects.findOne.mockResolvedValue(PROJECT)
    mockDeps(db)
    const { scheduleEventNotification } = await import(
      '../../../app/src/ScheduleEventNotifications.mjs'
    )
    const result = await scheduleEventNotification('projectRenamed', {
      projectId: 'proj-1',
      actorId: 'owner-1',
    })
    expect(result.scheduled).toBe(2) // collab + viewer (owner excluded)
  })

  it('notifies a single user for specific-user events (memberAdded)', async () => {
    const db = makeDb()
    db.db.projects.findOne.mockResolvedValue(PROJECT)
    mockDeps(db)
    const { scheduleEventNotification } = await import(
      '../../../app/src/ScheduleEventNotifications.mjs'
    )
    const result = await scheduleEventNotification('memberAdded', {
      projectId: 'proj-1',
      actorId: 'owner-1',
      targetUserId: 'new-member-1',
    })
    expect(result.scheduled).toBe(1)
    // the upsert filter targets the specific user
    const filter = db.updateOne.mock.calls[0][0]
    expect(filter.recipient_id.s).toBe('new-member-1')
  })

  it('skips a recipient who muted all notifications', async () => {
    const db = makeDb()
    db.db.notificationsPreferences.findOne.mockImplementation(async q => {
      if (q.user_id.s === 'owner-1') {
        return { muteAllNotifications: true }
      }
      return null
    })
    db.db.projects.findOne.mockResolvedValue(PROJECT)
    mockDeps(db)
    const { scheduleEventNotification } = await import(
      '../../../app/src/ScheduleEventNotifications.mjs'
    )
    const result = await scheduleEventNotification('projectExpiring', {
      projectId: 'proj-1',
    })
    expect(result.scheduled).toBe(2) // owner muted, collab + viewer notified
  })

  it('skips a recipient who switched the event off', async () => {
    const db = makeDb()
    db.db.notificationsPreferences.findOne.mockImplementation(async q => {
      if (q.user_id.s === 'owner-1') {
        return { muteAllNotifications: false, events: { projectExpiring: false } }
      }
      return null
    })
    db.db.projects.findOne.mockResolvedValue(PROJECT)
    mockDeps(db)
    const { scheduleEventNotification } = await import(
      '../../../app/src/ScheduleEventNotifications.mjs'
    )
    const result = await scheduleEventNotification('projectExpiring', {
      projectId: 'proj-1',
    })
    expect(result.scheduled).toBe(2)
  })

  it('uses the captured member list when the project is already gone (projectDeleted)', async () => {
    const db = makeDb()
    db.db.projects.findOne.mockResolvedValue(null) // destroyed
    mockDeps(db)
    const { scheduleEventNotification } = await import(
      '../../../app/src/ScheduleEventNotifications.mjs'
    )
    const result = await scheduleEventNotification('projectDeleted', {
      projectId: 'proj-1',
      context: { memberIds: ['owner-1', 'collab-1'] },
    })
    expect(result.scheduled).toBe(2)
  })

  it('returns 0 for an unknown event', async () => {
    const db = makeDb()
    mockDeps(db)
    const { scheduleEventNotification } = await import(
      '../../../app/src/ScheduleEventNotifications.mjs'
    )
    const result = await scheduleEventNotification('notARealEvent', {
      projectId: 'proj-1',
    })
    expect(result.scheduled).toBe(0)
  })
})
