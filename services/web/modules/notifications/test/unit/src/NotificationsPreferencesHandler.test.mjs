import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  normalizeGlobalPreferences,
  normalizeGlobalDelayMinutes,
} from '../../../app/src/PreferenceNormalizer.mjs'
import path from 'node:path'

const handlerPath = path.join(
  import.meta.dirname,
  '../../../app/src/NotificationsPreferencesHandler.mjs'
)

// A minimal ObjectId stand-in: only .toString() identity is exercised,
// so we can key on the string form of the id.
class FakeObjectId {
  constructor(value) {
    this.value = String(value)
  }
  toString() {
    return this.value
  }
}

describe('normalizeGlobalPreferences', function () {
  it('keeps a valid user delay in minutes', function () {
    expect(
      normalizeGlobalPreferences({ notificationDelayMinutes: '5' })
        .notificationDelayMinutes
    ).toBe(5)
    expect(
      normalizeGlobalPreferences({ notificationDelayMinutes: 10080 })
        .notificationDelayMinutes
    ).toBe(10080)
  })

  it('drops missing, empty, or invalid user delays to null (server default)', function () {
    expect(
      normalizeGlobalPreferences({}).notificationDelayMinutes
    ).toBeNull()
    expect(
      normalizeGlobalPreferences({ notificationDelayMinutes: '' })
        .notificationDelayMinutes
    ).toBeNull()
    expect(
      normalizeGlobalPreferences({ notificationDelayMinutes: 'abc' })
        .notificationDelayMinutes
    ).toBeNull()
    expect(
      normalizeGlobalPreferences({ notificationDelayMinutes: -1 })
        .notificationDelayMinutes
    ).toBeNull()
    expect(
      normalizeGlobalPreferences({ notificationDelayMinutes: 0.5 })
        .notificationDelayMinutes
    ).toBeNull()
    expect(
      normalizeGlobalPreferences({ notificationDelayMinutes: 10081 })
        .notificationDelayMinutes
    ).toBeNull()
  })

  it('normalizesGlobalDelayMinutes directly', function () {
    expect(normalizeGlobalDelayMinutes(30)).toBe(30)
    expect(normalizeGlobalDelayMinutes('30')).toBe(30)
    expect(normalizeGlobalDelayMinutes(null)).toBeNull()
    expect(normalizeGlobalDelayMinutes(100000)).toBeNull()
  })
})

describe('NotificationsPreferencesHandler', function () {
  beforeEach(async function (ctx) {
    ctx.notificationsPreferences = {
      findOne: vi.fn().mockResolvedValue(null),
      updateOne: vi.fn().mockResolvedValue({}),
    }

    ctx.getProject = vi.fn()

    vi.doMock(
      '../../../../../app/src/infrastructure/mongodb.mjs',
      () => ({
        db: { notificationsPreferences: ctx.notificationsPreferences },
        ObjectId: FakeObjectId,
        connectionPromise: Promise.resolve(),
      })
    )

    vi.doMock(
      '../../../../../app/src/Features/Project/ProjectGetter.mjs',
      async () => {
        const mod = { promises: { getProject: ctx.getProject } }
        return { default: mod }
      }
    )

    const Errors = (
      await import(
        path.join(
          import.meta.dirname,
          '../../../../../app/src/Features/Errors/Errors.js'
        )
      )
    ).default

    ctx.NotFoundError = Errors.NotFoundError
    ctx.ForbiddenError = Errors.ForbiddenError

    ctx.Handler = (await import(handlerPath)).default
  })

  function makeProject(role, userId) {
    return {
      owner_ref: role === 'owner' ? userId : 'owner-1',
      collaberator_refs:
        role === 'collaborator' ? [userId] : [],
      readOnly_refs: [],
      tokenAccessReadAndWrite_refs: [],
      tokenAccessReadOnly_refs: [],
    }
  }

  it('returns defaults (all true) when no project preference exists', async function (ctx) {
    ctx.getProject.mockResolvedValue(makeProject('owner', 'user-1'))

    const prefs = await ctx.Handler.promises.getProjectPreferences('user-1', 'p-1')

    // 12 project keys + the merged-in global muteAllNotifications flag
    expect(Object.keys(prefs)).toHaveLength(13)
    expect(prefs.muteAllNotifications).toBe(false)
    expect(Object.values(prefs).every(Boolean)).toBe(false)
  })

  it('forwards stored preferences and normalizes missing keys to true', async function (ctx) {
    ctx.getProject.mockResolvedValue(makeProject('collaborator', 'user-1'))
    ctx.notificationsPreferences.findOne.mockResolvedValueOnce({
      commentOnOwnProject: false,
    })

    const prefs = await ctx.Handler.promises.getProjectPreferences('user-1', 'p-1')

    expect(prefs.commentOnOwnProject).toBe(false)
    expect(prefs.trackedChangesOnOwnProject).toBe(true)
  })

  it('merges the global muteAllNotifications flag into the project view', async function (ctx) {
    ctx.getProject.mockResolvedValue(makeProject('owner', 'user-1'))
    ctx.notificationsPreferences.findOne
      .mockResolvedValueOnce({ commentOnOwnProject: false })
      .mockResolvedValueOnce({ muteAllNotifications: true })

    const prefs = await ctx.Handler.promises.getProjectPreferences('user-1', 'p-1')

    expect(prefs.muteAllNotifications).toBe(true)
    expect(prefs.commentOnOwnProject).toBe(false)
  })

  it('throws not-found when project does not exist', async function (ctx) {
    ctx.getProject.mockResolvedValue(null)

    let error = null
    try {
      await ctx.Handler.promises.getProjectPreferences('user-1', 'p-1')
    } catch (err) {
      error = err
    }

    expect(error).toBeInstanceOf(ctx.NotFoundError)
    expect(error.message).toMatch('not found')
  })

  it('throws forbidden when user has no access to the project', async function (ctx) {
    ctx.getProject.mockResolvedValue(makeProject('other', 'other-user'))

    let error = null
    try {
      await ctx.Handler.promises.saveProjectPreferences(
        'user-1',
        'p-1',
        { commentOnOwnProject: false }
      )
    } catch (err) {
      error = err
    }

    expect(error).toBeInstanceOf(ctx.ForbiddenError)
    expect(error.message).toMatch('not allowed to access')
  })

  it('saves normalized project preferences with upsert', async function (ctx) {
    ctx.getProject.mockResolvedValue(makeProject('owner', 'user-1'))

    const normalized = await ctx.Handler.promises.saveProjectPreferences(
      'user-1',
      'p-1',
      { commentOnOwnProject: false }
    )

    expect(normalized.commentOnOwnProject).toBe(false)
    expect(Object.keys(normalized)).toHaveLength(12)
    expect(ctx.notificationsPreferences.updateOne).toHaveBeenCalledWith(
      { user_id: expect.any(FakeObjectId), project_id: expect.any(FakeObjectId) },
      { $set: normalized },
      { upsert: true }
    )
  })

  it('reads and writes global preferences with project_id: null', async function (ctx) {
    const global = await ctx.Handler.promises.saveGlobalPreferences('user-1', {
      muteAllNotifications: true,
    })
    expect(global).toEqual({
      muteAllNotifications: true,
      notificationDelayMinutes: null,
      notificationUrl: null,
      events: { projectChanges: true, comments: true },
    })
    expect(ctx.notificationsPreferences.updateOne).toHaveBeenCalledWith(
      { user_id: expect.any(FakeObjectId), project_id: null },
      {
        $set: {
          muteAllNotifications: true,
          notificationDelayMinutes: null,
          notificationUrl: null,
          events: { projectChanges: true, comments: true },
        },
      },
      { upsert: true }
    )

    // a user-defined delay round-trips through the same handler
    const withDelay = await ctx.Handler.promises.saveGlobalPreferences('user-1', {
      muteAllNotifications: true,
      notificationDelayMinutes: '42',
    })
    expect(withDelay).toEqual({
      muteAllNotifications: true,
      notificationDelayMinutes: 42,
      notificationUrl: null,
      events: { projectChanges: true, comments: true },
    })

    // a per-user Apprise channel URL round-trips (and empty string -> null)
    const withUrl = await ctx.Handler.promises.saveGlobalPreferences('user-1', {
      muteAllNotifications: false,
      notificationUrl: ' tg://bot-token/chat-id ',
    })
    expect(withUrl.notificationUrl).toBe('tg://bot-token/chat-id')
    const cleared = await ctx.Handler.promises.saveGlobalPreferences('user-1', {
      muteAllNotifications: false,
      notificationUrl: '   ',
    })
    expect(cleared.notificationUrl).toBeNull()
  })
})
