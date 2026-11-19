import { beforeEach, describe, expect, it, vi } from 'vitest'
import path from 'node:path'

const schedulerPath = path.join(
  import.meta.dirname,
  '../../../app/src/ScheduleProjectChangeNotifications.mjs'
)

describe('scheduleProjectChangeNotifications', function () {
  beforeEach(async function (ctx) {
    ctx.db = {
      notificationsPreferences: {
        find: () => ({ toArray: vi.fn().mockResolvedValue([]) }),
      },
      emailNotifications: {
        updateOne: vi.fn().mockResolvedValue({ upsertedCount: 1 }),
      },
      projects: { findOne: vi.fn().mockResolvedValue(null) },
    }

    vi.doMock(
      '../../../../../app/src/infrastructure/mongodb.mjs',
      () => ({
        get db() {
          return ctx.db
        },
        ObjectId: class {
          constructor(v) {
            this.v = v
          }
          toString() {
            return String(this.v)
          }
        },
        connectionPromise: Promise.resolve(),
      })
    )

    vi.doMock('@overleaf/logger', () => ({
      default: { debug: vi.fn(), warn: vi.fn() },
    }))

    ctx.Loader = (await import(schedulerPath))
    delete process.env.PROJECT_CHANGE_NOTIFICATION_MIN_DELAY_MS
  })

  function project(projectId, owner, collabs) {
    return {
      _id: projectId,
      name: 'My Project',
      owner_ref: owner,
      collaberator_refs: collabs,
      readOnly_refs: [],
      tokenAccessReadAndWrite_refs: [],
      tokenAccessReadOnly_refs: [],
    }
  }

  it('skips when the change is too recent (debounce)', async function (ctx) {
    const res = await ctx.Loader.scheduleProjectChangeNotifications({
      projectId: 'p-1',
      timestamp: Date.now() - 100,
    })
    expect(res.skipped).toBe('debounce')
  })

  it('skips when the project does not exist', async function (ctx) {
    ctx.db.projects.findOne.mockResolvedValue(null)
    const res = await ctx.Loader.scheduleProjectChangeNotifications({
      projectId: 'p-1',
      timestamp: Date.now() - 9999999,
    })
    expect(res.skipped).toBe('project-not-found')
  })

  it('schedules emails only for opted-in members', async function (ctx) {
    ctx.db.projects.findOne.mockResolvedValue(
      project('p-1', 'owner-1', ['collab-1'])
    )

    const find = vi
      .fn()
      .mockImplementation(({ user_id, project_id }) => ({
        toArray: vi.fn().mockResolvedValue(
          project_id === null
            ? [{ user_id: 'collab-1', muteAllNotifications: true }]
            : []
        ),
      }))
    ctx.db.notificationsPreferences = { find }

    const updateOne = vi.fn().mockResolvedValue({ upsertedCount: 1 })
    ctx.db.emailNotifications = { updateOne }

    const res = await ctx.Loader.scheduleProjectChangeNotifications({
      projectId: 'p-1',
      timestamp: Date.now() - 9999999,
    })

    // owner-1 defaults to opted-in; collab-1 is muted globally
    expect(updateOne).toHaveBeenCalledTimes(1)
    expect(res.scheduled).toBe(1)
  })

  it('excludes the editor who made the change from recipients', async function (ctx) {
    ctx.db.projects.findOne.mockResolvedValue(
      project('p-1', 'editor-1', ['collab-1'])
    )

    const updateOne = vi.fn().mockResolvedValue({ upsertedCount: 1 })
    ctx.db.emailNotifications = { updateOne }

    const res = await ctx.Loader.scheduleProjectChangeNotifications({
      projectId: 'p-1',
      timestamp: Date.now() - 9999999,
      userId: 'editor-1',
    })

    // the editor (the owner here) does NOT get the email; the collaborator does
    expect(updateOne).toHaveBeenCalledTimes(1)
    expect(updateOne.mock.calls[0][0].recipient_id.v).toBe('collab-1')
    expect(res.scheduled).toBe(1)
  })

  it('still notifies the owner when a collaborator made the change', async function (ctx) {
    ctx.db.projects.findOne.mockResolvedValue(
      project('p-1', 'owner-1', ['editor-1'])
    )

    const updateOne = vi.fn().mockResolvedValue({ upsertedCount: 1 })
    ctx.db.emailNotifications = { updateOne }

    const res = await ctx.Loader.scheduleProjectChangeNotifications({
      projectId: 'p-1',
      timestamp: Date.now() - 9999999,
      userId: 'editor-1',
    })

    expect(updateOne).toHaveBeenCalledTimes(1)
    expect(updateOne.mock.calls[0][0].recipient_id.v).toBe('owner-1')
    expect(res.scheduled).toBe(1)
  })

  it('schedules nothing when the editor is the only member', async function (ctx) {
    ctx.db.projects.findOne.mockResolvedValue(project('p-1', 'editor-1', []))

    const updateOne = vi.fn().mockResolvedValue({ upsertedCount: 1 })
    ctx.db.emailNotifications = { updateOne }

    const res = await ctx.Loader.scheduleProjectChangeNotifications({
      projectId: 'p-1',
      timestamp: Date.now() - 9999999,
      userId: 'editor-1',
    })

    expect(updateOne).not.toHaveBeenCalled()
    expect(res.scheduled).toBe(0)
  })

  it('schedules a recipient with a user-defined delay at batchTime + delay', async function (ctx) {
    const batchTs = Date.now() - 5 * 60 * 1000 // past the default 2 min debounce
    ctx.db.notificationsPreferences.find = query => ({
      toArray: vi.fn().mockResolvedValue(
        query.project_id === null
          ? [
              {
                user_id: 'member-2',
                project_id: null,
                muteAllNotifications: false,
                notificationDelayMinutes: 10,
              },
            ]
          : []
      ),
    })
    ctx.db.projects.findOne.mockResolvedValue(
      project('p-1', 'editor-1', ['member-2'])
    )

    const updateOne = vi.fn().mockResolvedValue({ upsertedCount: 1 })
    ctx.db.emailNotifications = { updateOne }

    await ctx.Loader.scheduleProjectChangeNotifications({
      projectId: 'p-1',
      timestamp: batchTs,
      userId: 'editor-1',
    })

    const scheduledAt = updateOne.mock.calls[0][1].$set.scheduledAt
    // 10 min after the batch's change (in the future from now)
    expect(scheduledAt.getTime()).toBe(batchTs + 10 * 60 * 1000)
  })

  it('schedules recipients without a user delay immediately (server default)', async function (ctx) {
    const batchTs = Date.now() - 5 * 60 * 1000
    ctx.db.projects.findOne.mockResolvedValue(
      project('p-1', 'editor-1', ['member-2'])
    )

    const updateOne = vi.fn().mockResolvedValue({ upsertedCount: 1 })
    ctx.db.emailNotifications = { updateOne }

    const before = Date.now()
    await ctx.Loader.scheduleProjectChangeNotifications({
      projectId: 'p-1',
      timestamp: batchTs,
      userId: 'editor-1',
    })

    // no override -> server default deadline already passed -> due now
    const scheduledAt = updateOne.mock.calls[0][1].$set.scheduledAt
    expect(scheduledAt.getTime()).toBeGreaterThanOrEqual(before - 1)
    expect(scheduledAt.getTime()).toBeLessThanOrEqual(Date.now() + 1000)
  })

  it('mixes per-recipient delays within the same batch', async function (ctx) {
    const batchTs = Date.now() - 5 * 60 * 1000
    ctx.db.notificationsPreferences.find = query => ({
      toArray: vi.fn().mockResolvedValue(
        query.project_id === null
          ? [
              {
                user_id: 'member-2',
                project_id: null,
                muteAllNotifications: false,
                notificationDelayMinutes: 20,
              },
            ]
          : []
      ),
    })
    ctx.db.projects.findOne.mockResolvedValue(
      project('p-1', 'editor-1', ['member-2', 'member-3'])
    )

    const updateOne = vi.fn().mockResolvedValue({ upsertedCount: 1 })
    ctx.db.emailNotifications = { updateOne }

    await ctx.Loader.scheduleProjectChangeNotifications({
      projectId: 'p-1',
      timestamp: batchTs,
      userId: 'editor-1',
    })

    const calls = updateOne.mock.calls.map(call => ({
      recipient: call[1].$set.recipient_id.v,
      t: call[1].$set.scheduledAt.getTime(),
    }))
    const delayed = calls.find(c => c.recipient === 'member-2')
    const defaultRecipient = calls.find(c => c.recipient === 'member-3')
    expect(delayed.t).toBe(batchTs + 20 * 60 * 1000)
    // default recipient is due now, long before the delayed one
    expect(defaultRecipient.t).toBeLessThan(delayed.t - 10 * 60 * 1000)
  })

  it('reschedules with a clean delivery state (resets retry/dead-letter state)', async function (ctx) {
    const batchTs = Date.now() - 5 * 60 * 1000
    ctx.db.projects.findOne.mockResolvedValue(
      project('p-1', 'editor-1', ['member-2'])
    )

    const updateOne = vi.fn().mockResolvedValue({ upsertedCount: 1 })
    ctx.db.emailNotifications = { updateOne }

    await ctx.Loader.scheduleProjectChangeNotifications({
      projectId: 'p-1',
      timestamp: batchTs,
      userId: 'editor-1',
    })

    const update = updateOne.mock.calls[0][1]
    // without this reset, a previously failed/dead-lettered doc would keep
    // suppressing new notifications for the same recipient+project forever
    expect(update.$set.attempts).toBe(0)
    expect(update.$set.processing).toBe(false)
    expect(update.$unset).toEqual({
      nextRetryAt: '',
      processingError: '',
      processingStartedAt: '',
      dead: '',
    })
  })
})
