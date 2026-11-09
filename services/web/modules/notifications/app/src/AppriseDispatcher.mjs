// @ts-check
/**
 * Notification dispatch.
 *
 * Channels are selected by a URL (built from the user's structured channel
 * settings or a legacy raw URL):
 *
 *   mailto://jane@example.com   email
 *   webpush://<b64url(sub)>     browser push (Web Push / VAPID)
 *   tg://…, discord://…, ntfy://…   third-party channels
 *
 * Transport:
 *   - Browser push is ALWAYS sent by this process (Node `web-push`), so it
 *     works without the Apprise container. Overleaf owns the VAPID keys
 *     (generated once, stored in `notificationSettings`).
 *   - Email prefers the Apprise container (its SMTP defaults come from the
 *     compose env), but falls back to this process's own SMTP transport
 *     (nodemailer via EmailSender) when Apprise is not configured or is
 *     unreachable — small installations do not need the container.
 *   - Every other channel requires Apprise; without it we fail with a
 *     clear error (those channels are meaningless without the API).
 *
 * Recipient URL resolution:
 *   1. the user's ACTIVE channel (structured values from
 *      /user/notification-preferences, built via the ChannelCatalog),
 *   2. the legacy raw `notificationUrl` preference, if set,
 *   3. fallback: mailto://<user email>.
 */

import logger from '@overleaf/logger'
import { db, ObjectId, connectionPromise } from '../../../../app/src/infrastructure/mongodb.mjs'

/**
 * Apprise API base URL (read lazily so tests and runtime config can
 * change it). Empty = Apprise not configured (small installation:
 * email + browser push run inside this process).
 */
function appriseApiUrl() {
  return (process.env.NOTIFICATIONS_APPRISDE_API_URL || '').replace(/\/+$/, '')
}

export function appriseConfigured() {
  return appriseApiUrl() !== ''
}

function requestTimeoutMs() {
  return Number(process.env.NOTIFICATIONS_APPRISDE_TIMEOUT_MS) || 60000
}

const SETTINGS_ID = 'global'

/**
 * Resolve the channel URL for a recipient.
 * @param {string|null} userId
 * @param {string|null} email
 * @returns {Promise<string|null>}
 */
export async function resolveRecipientUrl(userId, email) {
  if (userId) {
    try {
      const doc = await db.notificationsPreferences.findOne(
        { user_id: new ObjectId(userId), project_id: null },
        { projection: { _id: 0 } }
      )

      // 1. active channel (structured, built into a channel URL)
      const active = doc?.activeChannel
      if (active && doc?.channels?.[active]) {
        try {
          const { buildChannelUrl } = await import('./ChannelCatalog.mjs')
          const url = buildChannelUrl(
            active,
            doc.channels[active],
            doc?.pinned || {}
          )
          if (url) return url
        } catch (err) {
          logger.warn(
            { err, userId, active },
            'active channel could not be built — falling back'
          )
        }
      }

      // 2. legacy raw URL
      if (doc && typeof doc.notificationUrl === 'string' && doc.notificationUrl.trim()) {
        return doc.notificationUrl.trim()
      }
    } catch (err) {
      logger.warn({ err, userId }, 'could not load notification channel preferences')
    }
  }

  if (email) {
    return `mailto://${email}`
  }

  return null
}

// ─── VAPID keys (browser push) — owned by this process ─────────────────────
//
// Generated once and persisted in the `notificationSettings` global doc so
// they survive restarts and can be rotated by an admin (delete the
// `webpush` field). Subscriptions are bound to the public key, so they must
// stay stable — do not regenerate casually.

let _vapidPromise = null

export async function getVapidKeys() {
  if (_vapidPromise) return _vapidPromise
  _vapidPromise = (async () => {
    await connectionPromise
    const doc = await db.notificationSettings
      .findOne({ _id: SETTINGS_ID })
      .catch(() => null)
    if (doc?.webpush?.vapid?.publicKey && doc?.webpush?.vapid?.privateKey) {
      return doc.webpush.vapid
    }

    const { generateVAPIDKeys } = await import('web-push')
    const { publicKey, privateKey } = generateVAPIDKeys()
    await db.notificationSettings.updateOne(
      { _id: SETTINGS_ID },
      { $set: { 'webpush.vapid': { publicKey, privateKey, createdAt: new Date() } } },
      { upsert: true }
    )
    logger.info('generated new VAPID keys for browser push (stored in notificationSettings)')
    return { publicKey, privateKey }
  })()
  // do not cache a failed generation forever
  _vapidPromise.catch(() => {
    _vapidPromise = null
  })
  return _vapidPromise
}

/**
 * Send a browser push via Node `web-push`.
 * @param {string} webPushUrl 'webpush://<base64url(pushSubscription)>'
 * @param {{title:string, body:string, url?:string|null}} payload
 */
export async function sendBrowserPush(webPushUrl, { title, body, url = null }) {
  const encoded = webPushUrl.slice('webpush://'.length)
  let subscription
  try {
    subscription = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
  } catch {
    throw new Error('invalid webpush URL (subscription could not be decoded)')
  }
  if (!subscription?.endpoint || !subscription?.keys) {
    throw new Error('webpush subscription is malformed')
  }

  const { setVapidDetails, sendNotification } = await import('web-push')
  const { publicKey, privateKey } = await getVapidKeys()
  setVapidDetails(
    `mailto:${process.env.OVERLEAF_EMAIL_FROM_ADDRESS || 'overleaf@localhost'}`,
    publicKey,
    privateKey
  )

  const payload = JSON.stringify({
    title,
    body,
    url: url || null,
  })

  try {
    await sendNotification(subscription, payload, { TTL: 120 })
  } catch (err) {
    const status = err?.statusCode || err?.status
    if (status === 404 || status === 410) {
      throw new Error('browser push subscription expired — user must re-enable browser notifications')
    }
    throw new Error(`browser push failed${status ? ` (HTTP ${status})` : ''}: ${err?.message || err}`)
  }

  logger.info('notification dispatched via node web-push (browser)')
  return { via: 'node-webpush' }
}

// ─── Email ─────────────────────────────────────────────────────────────────

/**
 * Send one notification email using this process's own SMTP transport
 * (nodemailer, configured by the web `email` settings).
 * This is the fallback for small installations without the Apprise
 * container — and the safety net when Apprise is down.
 *
 * Uses a dedicated transport because the global EmailSender may have
 * incorrect TLS settings (e.g. secure=false on port 465).
 */
let _directTransport = null

let _directTransportPromise = null

function getDirectTransport() {
  if (_directTransport) return Promise.resolve(_directTransport)
  if (_directTransportPromise) return _directTransportPromise
  _directTransportPromise = (async () => {
    const [nodemailer, Settings] = await Promise.all([
      import('nodemailer'),
      import('@overleaf/settings'),
    ])
    const emailSettings = Settings.default.email || {}
    const params = emailSettings.parameters || {}
    const smtp = {
      host: params.host,
      port: Number(params.port) || 465,
      secure: Number(params.port) === 465 || params.secure === true,
      auth: params.auth ? { user: params.auth.user, pass: params.auth.pass } : undefined,
      socketTimeout: 30000,
      logger: false,
    }
    if (!smtp.host) {
      throw new Error('no SMTP host configured for direct email fallback')
    }
    _directTransport = nodemailer.createTransport(smtp)
    return _directTransport
  })()
  _directTransportPromise.catch(() => { _directTransportPromise = null })
  return _directTransportPromise
}

export async function sendDirectEmail(recipientEmail, { title, body, url = null }) {
  const transport = await getDirectTransport()
  const Settings = (await import('@overleaf/settings')).default
  const from = Settings.email?.fromAddress || undefined
  await transport.sendMail({
    to: recipientEmail,
    from,
    subject: title,
    text: body,
    html: `<p>${body
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
      .replace(/\n/g, '<br/>')}</p>`,
  })
  logger.info({ recipientEmail }, 'notification dispatched via direct SMTP (web process)')
  return { via: 'direct-smtp' }
}

// ─── Apprise (third-party channels + optional email) ───────────────────────

async function sendViaApprise(targetUrl, { title, body, format }) {
  let response
  try {
    response = await fetch(`${appriseApiUrl()}/notify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: targetUrl, title, body, format }),
      signal: AbortSignal.timeout(requestTimeoutMs()),
    })
  } catch (err) {
    throw new Error(`apprise API unreachable at ${appriseApiUrl()}: ${err?.message || err}`)
  }

  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(`apprise API responded ${response.status}`)
  }
  if (data.status !== 1) {
    const detail = Array.isArray(data.messages) ? data.messages.join('; ') : data.message
    throw new Error(detail || 'apprise reported a dispatch failure')
  }

  logger.info(
    { scheme: String(targetUrl).split(':')[0] },
    'notification dispatched via apprise'
  )
  return data
}

/**
 * Send one notification on the recipient's channel.
 *
 * Transport selection:
 *   - `webpush://`  → always this process (Node web-push)
 *   - `mailto://`   → Apprise if configured, otherwise (or on failure)
 *                     direct SMTP from this process
 *   - anything else → Apprise (required)
 *
 * Throws on any dispatch failure (the queue processor then applies its
 * backoff / dead-letter logic).
 *
 * @param {{title:string, body:string, format?:string, userId?:string|null, email?:string|null, url?:string|null}} task
 */
export async function sendAppriseNotification({
  title,
  body,
  format = 'markdown',
  userId = null,
  email = null,
  url = null,
}) {
  await connectionPromise

  const target = url || (await resolveRecipientUrl(userId, email))
  if (!target) {
    throw new Error(
      'no notification channel for recipient (no email and no notificationUrl preference)'
    )
  }

  const scheme = String(target).split(':')[0].toLowerCase()
  const context = { title, body, format, userId, email, url: target }

  // Browser push: always handled here (no Apprise needed).
  if (scheme === 'webpush') {
    return sendBrowserPush(target, { title, body, url: null })
  }

  // Third-party channels require Apprise.
  if (scheme !== 'mailto') {
    if (!appriseConfigured()) {
      throw new Error(
        `the "${scheme}" channel requires the Apprise container (NOTIFICATIONS_APPRISDE_API_URL is not set)`
      )
    }
    return sendViaApprise(target, { title, body, format })
  }

  // Email: prefer Apprise, fall back to this process's own SMTP.
  if (appriseConfigured()) {
    try {
      return await sendViaApprise(target, { title, body, format })
    } catch (err) {
      logger.warn(
        { err, target },
        'apprise email dispatch failed — falling back to direct SMTP'
      )
    }
  } else {
    logger.debug('apprise not configured — sending email via direct SMTP')
  }

  const recipientEmail = target.replace(/^mailto:\/\//, '')
  if (!recipientEmail) {
    throw new Error('could not determine recipient email from mailto URL')
  }
  return sendDirectEmail(recipientEmail, context)
}
