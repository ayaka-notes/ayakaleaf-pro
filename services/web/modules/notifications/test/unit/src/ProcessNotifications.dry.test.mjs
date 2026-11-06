import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import path from 'node:path'

const modulePath = path.join(
  import.meta.dirname,
  '../../../app/src/ProcessNotifications.mjs'
)

// Separate file: DRY_RUN is captured at module import time, so this module
// instance must be imported with the flag set.
describe('ProcessNotifications (dry run)', function () {
  beforeAll(() => {
    process.env.OVERLEAF_NOTIFICATIONS_DRY_RUN = 'true'
    process.env.PROCESS_NOTIFICATIONS_BATCH_SIZE = '100'
  })

  let ctx

  beforeEach(async function () {
    ctx = {
      emailNotifications: {
        findOneAndUpdate: vi.fn(),
        deleteOne: vi.fn().mockResolvedValue(undefined),
        updateOne: vi.fn().mockResolvedValue(undefined),
        updateMany: vi.fn().mockResolvedValue({ n: 0 }),
      },
      sendEmail: vi.fn().mockResolvedValue(undefined),
      getUser: vi.fn().mockResolvedValue({ email: 'user@example.com' }),
    }

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
        sendAppriseNotification: ctx.sendEmail,
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

    vi.resetModules()
    ctx.ProcessNotifications = await import(modulePath)
  })

  it('should dry-process one doc exactly once (no re-claim spin), release it, and send nothing', async function () {
    const notification = {
      _id: 'dry-1',
      emailType: 'testEmail',
      opts: { to: 'user@example.com' },
    }

    ctx.emailNotifications.findOneAndUpdate
      .mockResolvedValueOnce(notification)
      .mockResolvedValueOnce(null)

    const result = await ctx.ProcessNotifications.processNotifications()

    expect(result.notificationsFound).toBe(1)
    expect(result.dryRunProcessed).toBe(1)
    expect(result.dryRunWouldHaveSent).toBe(1)
    expect(result.emailsSent).toBe(0)
    expect(ctx.sendEmail).not.toHaveBeenCalled()
    // Regression (F8): the pre-fix loop re-claimed the reset doc until it hit
    // the batch size — findOneAndUpdate would be called 101 times, not 2.
    expect(ctx.emailNotifications.findOneAndUpdate).toHaveBeenCalledTimes(2)
    // Released in one batch afterwards (queue left un-consumed).
    expect(ctx.emailNotifications.updateMany).toHaveBeenCalledWith(
      { _id: { $in: ['dry-1'] } },
      expect.objectContaining({ $set: { processing: false } })
    )
  })

  it('should dry-process due docs in order, once each', async function () {
    const a = {
      _id: 'dry-2',
      emailType: 'testEmail',
      opts: { to: 'user@example.com' },
    }
    const b = {
      _id: 'dry-3',
      emailType: 'testEmail',
      recipient_id: 'user-1',
      opts: { projectId: 'p-1' },
    }

    ctx.emailNotifications.findOneAndUpdate
      .mockResolvedValueOnce(a)
      .mockResolvedValueOnce(b)
      .mockResolvedValueOnce(null)

    const result = await ctx.ProcessNotifications.processNotifications()

    expect(result.notificationsFound).toBe(2)
    expect(result.dryRunProcessed).toBe(2)
    expect(result.emailsSent).toBe(0)
    expect(ctx.emailNotifications.updateMany).toHaveBeenCalledWith(
      { _id: { $in: ['dry-2', 'dry-3'] } },
      expect.objectContaining({ $set: { processing: false } })
    )
  })
})
