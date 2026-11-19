import { beforeEach, describe, expect, it, vi } from 'vitest'
import path from 'node:path'

const schedulerPath = path.join(
  import.meta.dirname,
  '../../../app/src/ScheduleProjectChangeNotifications.mjs'
)

describe('scheduleCommentNotifications', function () {
  beforeEach(async function (ctx) {
    ctx.db = {
      notificationsPreferences: {
        find: vi.fn(() => ({ toArray: vi.fn().mockResolvedValue([]) })),
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
  })

  const OWNER = 'owner-1'
  const COLLAB = 'collab-1'
  const SENDER = 'collab-1'

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

  it('schedules for members except the sender', async function (ctx) {
    const projectId = 'proj-1'
    ctx.db.projects.findOne.mockResolvedValue(
      project(projectId, OWNER, [COLLAB])
    )

    const res = await ctx.Loader.scheduleCommentNotifications({
      projectId,
      userId: SENDER,
    })

    expect(res.scheduled).toBe(1)
    const call = ctx.db.emailNotifications.updateOne.mock.calls[0]
    expect(call[0].emailType).toBe('commentNotification')
    expect(call[0].recipient_id.toString()).toBe(OWNER)
    expect(call[1].$set.opts).toEqual({
      projectId,
      projectName: 'My Project',
    })
  })

  it('skips when the user disabled the comments event globally', async function (ctx) {
    const projectId = 'proj-1'
    ctx.db.projects.findOne.mockResolvedValue(
      project(projectId, OWNER, [COLLAB])
    )
    // both users have the event off
    ctx.db.notificationsPreferences.find.mockReturnValue({
      toArray: vi.fn().mockResolvedValue([
        {
          user_id: OWNER,
          muteAllNotifications: false,
          events: { projectChanges: true, comments: false },
        },
        {
          user_id: COLLAB,
          muteAllNotifications: false,
          events: { projectChanges: true, comments: false },
        },
      ]),
    })

    const res = await ctx.Loader.scheduleCommentNotifications({
      projectId,
      userId: SENDER,
    })

    expect(res.scheduled).toBe(0)
    expect(ctx.db.emailNotifications.updateOne).not.toHaveBeenCalled()
  })

  it('skips the sender even for the owner comment', async function (ctx) {
    const projectId = 'proj-1'
    // owner sends the comment; no other members
    ctx.db.projects.findOne.mockResolvedValue(
      project(projectId, OWNER, [])
    )

    const res = await ctx.Loader.scheduleCommentNotifications({
      projectId,
      userId: OWNER,
    })

    expect(res.scheduled).toBe(0)
  })
})
