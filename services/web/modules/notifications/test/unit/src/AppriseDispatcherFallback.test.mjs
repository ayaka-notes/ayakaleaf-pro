import { describe, it, expect, vi } from 'vitest'

// ─── Fallback dispatch ─────────────────────────────────────────────────────
//
// Verifies the Apprise-optional behaviour:
//   - browser push (webpush://) is always sent by this process (web-push),
//   - email (mailto://) goes via Apprise when configured, and falls back to
//     the direct SMTP transport (EmailSender) when Apprise is down or not
//     configured,
//   - third-party channels (tg://) require Apprise and fail without.
//
// Each test imports the dispatcher with a fresh mock registry (vi.doMock) so
// module-level state does not leak between cases.

function makeMocks() {
  const sendMail = vi.fn().mockResolvedValue({ messageId: 'test' })
  return {
    fetch: vi.fn(),
    sendMail,
    transport: { sendMail },
    webpush: {
      setVapidDetails: vi.fn(),
      sendNotification: vi.fn().mockResolvedValue(undefined),
      generateVAPIDKeys: vi.fn().mockReturnValue({
        publicKey: 'PUB_KEY',
        privateKey: 'PRIV_KEY',
      }),
    },
    settingsFindOne: vi.fn().mockResolvedValue(null),
    settingsUpdateOne: vi.fn().mockResolvedValue({}),
  }
}

function mockDeps(mocks) {
  vi.doMock('../../../../../app/src/infrastructure/mongodb.mjs', () => ({
    db: {
      notificationsPreferences: {
        findOne: vi.fn().mockResolvedValue(null),
      },
      notificationSettings: {
        findOne: mocks.settingsFindOne,
        updateOne: mocks.settingsUpdateOne,
      },
    },
    connectionPromise: Promise.resolve(),
    ObjectId: class ObjectId {
      constructor(s) {
        this.s = s
      }
    },
  }))
  vi.doMock('nodemailer', () => ({
    createTransport: () => mocks.transport,
  }))
  vi.doMock('@overleaf/settings', () => ({
    default: { email: { fromAddress: 'overleaf@test.local', parameters: { host: 'smtp.test', port: 465, auth: { user: 'u', pass: 'p' } } } },
  }))
  vi.doMock('web-push', () => mocks.webpush)
}

describe('sendAppriseNotification — fallback dispatch', () => {
  it('sends browser push with local web-push (no apprise call)', async () => {
    const mocks = makeMocks()
    globalThis.fetch = mocks.fetch
    process.env.NOTIFICATIONS_APPRISDE_API_URL = 'http://apprise.test:8001'
    process.env.OVERLEAF_EMAIL_FROM_ADDRESS = 'overleaf@example.com'
    mockDeps(mocks)

    const { sendAppriseNotification } = await import(
      '../../../app/src/AppriseDispatcher.mjs'
    )

    const sub = JSON.stringify({
      endpoint: 'https://push.example/x',
      keys: { p256dh: 'abc', auth: 'def' },
    })
    const url = `webpush://${Buffer.from(sub).toString('base64url')}`

    const result = await sendAppriseNotification({ title: 'T', body: 'B', url })

    expect(mocks.webpush.setVapidDetails).toHaveBeenCalledWith(
      'mailto:overleaf@example.com',
      'PUB_KEY',
      'PRIV_KEY'
    )
    expect(mocks.webpush.sendNotification).toHaveBeenCalledTimes(1)
    const [subscription, payload] = mocks.webpush.sendNotification.mock.calls[0]
    expect(subscription.endpoint).toBe('https://push.example/x')
    expect(JSON.parse(payload)).toMatchObject({ title: 'T', body: 'B' })
    expect(mocks.settingsUpdateOne).toHaveBeenCalled()
    expect(result).toMatchObject({ via: 'node-webpush' })
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('sends email via apprise when configured and healthy', async () => {
    const mocks = makeMocks()
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ status: 1, success: 1 }),
    })
    globalThis.fetch = mocks.fetch
    process.env.NOTIFICATIONS_APPRISDE_API_URL = 'http://apprise.test:8001'
    process.env.OVERLEAF_EMAIL_FROM_ADDRESS = 'overleaf@example.com'
    mockDeps(mocks)

    const { sendAppriseNotification } = await import(
      '../../../app/src/AppriseDispatcher.mjs'
    )

    const result = await sendAppriseNotification({
      title: 'T',
      body: 'B',
      email: 'jane@example.com',
    })

    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    expect(mocks.sendMail).not.toHaveBeenCalled()
    expect(result.status).toBe(1)
  })

  it('falls back to direct SMTP when apprise is down', async () => {
    const mocks = makeMocks()
    mocks.fetch.mockRejectedValue(new Error('ECONNREFUSED'))
    globalThis.fetch = mocks.fetch
    process.env.NOTIFICATIONS_APPRISDE_API_URL = 'http://apprise.test:8001'
    process.env.OVERLEAF_EMAIL_FROM_ADDRESS = 'overleaf@example.com'
    mockDeps(mocks)

    const { sendAppriseNotification } = await import(
      '../../../app/src/AppriseDispatcher.mjs'
    )

    const result = await sendAppriseNotification({
      title: 'T',
      body: 'B',
      email: 'jane@example.com',
    })

    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    expect(mocks.sendMail).toHaveBeenCalledTimes(1)
    expect(mocks.sendMail.mock.calls[0][0].to).toBe('jane@example.com')
    expect(result).toMatchObject({ via: 'direct-smtp' })
  })

  it('sends direct SMTP when apprise is not configured', async () => {
    const mocks = makeMocks()
    globalThis.fetch = mocks.fetch
    delete process.env.NOTIFICATIONS_APPRISDE_API_URL
    process.env.OVERLEAF_EMAIL_FROM_ADDRESS = 'overleaf@example.com'
    mockDeps(mocks)

    const { sendAppriseNotification, appriseConfigured } = await import(
      '../../../app/src/AppriseDispatcher.mjs'
    )

    expect(appriseConfigured()).toBe(false)

    const result = await sendAppriseNotification({
      title: 'T',
      body: 'B',
      email: 'jane@example.com',
    })

    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(mocks.sendMail).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ via: 'direct-smtp' })
  })

  it('fails clearly for third-party channels without apprise', async () => {
    const mocks = makeMocks()
    globalThis.fetch = mocks.fetch
    delete process.env.NOTIFICATIONS_APPRISDE_API_URL
    process.env.OVERLEAF_EMAIL_FROM_ADDRESS = 'overleaf@example.com'
    mockDeps(mocks)

    const { sendAppriseNotification } = await import(
      '../../../app/src/AppriseDispatcher.mjs'
    )

    let caught
    try {
      await sendAppriseNotification({ title: 'T', body: 'B', url: 'tg://token/chat' })
    } catch (e) {
      caught = e
    }
    if (!caught || !/requires the Apprise container/.test(caught.message)) {
      throw new Error('DBG caught=' + JSON.stringify(caught && {msg: caught.message, ctor: caught.constructor && caught.constructor.name}))
    }
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(mocks.sendMail).not.toHaveBeenCalled()
  })
})
