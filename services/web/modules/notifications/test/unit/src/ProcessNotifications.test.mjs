import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import path from 'node:path'

const modulePath = path.join(
  import.meta.dirname,
  '../../../app/src/ProcessNotifications.mjs'
)

describe('ProcessNotifications', function () {
  beforeAll(() => {
    // Keep dry-run off regardless of the host environment.
    delete process.env.OVERLEAF_NOTIFICATIONS_DRY_RUN
    process.env.PROCESS_NOTIFICATIONS_BATCH_SIZE = '100'
  })

  beforeEach(async function (ctx) {
    ctx.emailNotifications = {
      findOneAndUpdate: vi.fn(),
      deleteOne: vi.fn().mockResolvedValue(undefined),
      updateOne: vi.fn().mockResolvedValue(undefined),
    }
    ctx.sendAppriseNotification = vi.fn().mockResolvedValue({ status: 1, success: 1 })
    ctx.getUser = vi.fn().mockResolvedValue({ email: 'user@example.com' })

    vi.doMock(
      '../../../../../app/src/infrastructure/mongodb.mjs',
      () => ({
        db: {
          emailNotifications: ctx.emailNotifications,
        },
        connectionPromise: Promise.resolve(),
      })
    )

    vi.doMock('@overleaf/logger', () => ({
      default: {
        info: vi.fn(),
        warn: vi.fn(),
      },
    }))

    vi.doMock(
      '../../../app/src/AppriseDispatcher.mjs',
      () => ({
        sendAppriseNotification: ctx.sendAppriseNotification,
        APPRISDE_API_URL: 'http://apprise.test:8001',
      })
    )

    vi.doMock(
      '../../../../../app/src/Features/User/UserGetter.mjs',
      () => ({
        default: {
          promises: {
            getUser: ctx.getUser,
          },
        },
      })
    )

    ctx.ProcessNotifications = await import(modulePath)
  })

  it('should process and delete due scheduled notifications (production driver shape: raw doc)', async function (ctx) {
    const notification = {
      _id: 'notif-1',
      scheduledAt: new Date(Date.now() - 10000),
      emailType: 'testEmail',
      opts: { to: 'user@example.com' },
    }

    // PRODUCTION SHAPE verified in-container: the raw mongodb-legacy
    // collection resolves findOneAndUpdate to the doc itself (or null).
    ctx.emailNotifications.findOneAndUpdate
      .mockResolvedValueOnce(notification)
      .mockResolvedValueOnce(null)

    const result = await ctx.ProcessNotifications.processNotifications()

    expect(result.notificationsFound).toBe(1)
    expect(result.notificationsReady).toBe(1)
    expect(result.emailsSent).toBe(1)
    expect(ctx.emailNotifications.deleteOne).toHaveBeenCalledWith({
      _id: notification._id,
    })
  })

  it('should still handle { value: doc } wrapper shapes (other driver builds)', async function (ctx) {
    const notification = {
      _id: 'notif-1w',
      emailType: 'testEmail',
      opts: { to: 'user@example.com' },
    }
    ctx.emailNotifications.findOneAndUpdate
      .mockResolvedValueOnce({ value: notification })
      .mockResolvedValueOnce({ value: null })

    const result = await ctx.ProcessNotifications.processNotifications()

    expect(result.notificationsFound).toBe(1)
    expect(result.emailsSent).toBe(1)
  })

  it('should stop when there are no due notifications', async function (ctx) {
    ctx.emailNotifications.findOneAndUpdate.mockResolvedValue(null)

    const result = await ctx.ProcessNotifications.processNotifications()

    expect(result.notificationsFound).toBe(0)
    expect(ctx.emailNotifications.deleteOne).not.toHaveBeenCalled()
  })

  it('should resolve recipient_id into an email address', async function (ctx) {
    const notification = {
      _id: 'notif-2',
      scheduledAt: new Date(Date.now() - 10000),
      emailType: 'testEmail',
      recipient_id: 'user-1',
      opts: { projectId: 'p-1' },
    }

    ctx.emailNotifications.findOneAndUpdate
      .mockResolvedValueOnce(notification)
      .mockResolvedValueOnce(null)

    await ctx.ProcessNotifications.processNotifications()

    expect(ctx.getUser).toHaveBeenCalledWith('user-1', { email: 1 })
    expect(ctx.sendAppriseNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-1',
        email: 'user@example.com',
        title: expect.stringContaining('Overleaf'),
      })
    )
  })

  it('should back off and retry on failure', async function (ctx) {
    const notification = {
      _id: 'notif-3',
      scheduledAt: new Date(Date.now() - 10000),
      emailType: 'testEmail',
      opts: { to: 'user@example.com' },
    }

    ctx.emailNotifications.findOneAndUpdate
      .mockResolvedValueOnce(notification)
      .mockResolvedValue(null)
    ctx.sendAppriseNotification.mockRejectedValue(new Error('apprise down'))

    const result = await ctx.ProcessNotifications.processNotifications()

    expect(result.emailsSent).toBe(0)
    expect(ctx.emailNotifications.updateOne).toHaveBeenCalledWith(
      { _id: notification._id },
      expect.objectContaining({
        $set: expect.objectContaining({
          processing: false,
          attempts: 1,
          nextRetryAt: expect.any(Date),
        }),
      })
    )
  })

  it('should dead-letter after MAX_ATTEMPTS', async function (ctx) {
    const notification = {
      _id: 'notif-4',
      scheduledAt: new Date(Date.now() - 10000),
      emailType: 'testEmail',
      opts: { to: 'user@example.com' },
      attempts: 2,
    }

    ctx.emailNotifications.findOneAndUpdate
      .mockResolvedValueOnce(notification)
      .mockResolvedValue(null)
    ctx.sendAppriseNotification.mockRejectedValue(new Error('apprise down'))

    await ctx.ProcessNotifications.processNotifications()

    expect(ctx.emailNotifications.updateOne).toHaveBeenCalledWith(
      { _id: notification._id },
      expect.objectContaining({
        $set: expect.objectContaining({ dead: true }),
      })
    )
  })
})
