// @ts-check
/**
 * Channel catalog: the single source of truth for the notification channel
 * types the site offers.
 *
 * The admin toggles which types are enabled (and may pin values, e.g. the
 * Gotify/ntfy server host) via /admin/notifications; the user then fills in
 * simple per-channel fields on /user/notification-preferences. At dispatch
 * time the user's structured values are built into an Apprise URL — users
 * never see (or type) raw Apprise URLs unless the "custom URL" type is
 * enabled by the admin.
 *
 * Each entry:
 *   label / description — user-facing text (i18n keys)
 *   fields[]            — the inputs the user fills in
 *     { key, label, placeholder, secret?, help? }
 *   pinned[]            — field keys the admin may FIX for all users
 *                         (rendered read-only on the user page)
 *   build(values, pinned) -> Apprise URL (throws on missing required fields)
 *   browserPush         — special: no URL; the browser's PushSubscription
 *                         is stored and the apprise container delivers it
 */

const b64url = obj =>
  Buffer.from(JSON.stringify(obj)).toString('base64url')

/** Browser push: subscription JSON travels base64url-encoded after the
 *  scheme — the apprise container decodes it and signs the push with its
 *  own VAPID key. The click_url is the Overleaf URL of the notification. */
function buildWebPush(values) {
  const sub = values.subscription
  if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) {
    throw new Error('missing push subscription')
  }
  return `webpush://${b64url(sub)}`
}

const CATALOG = {
  telegram: {
    label: 'Telegram',
    fields: [
      {
        key: 'botToken',
        label: 'Bot token',
        placeholder: '123456:ABC-DEF…',
        secret: true,
      },
      { key: 'chatId', label: 'Chat ID', placeholder: '123456789' },
    ],
    build: v => {
      if (!v.botToken || !v.chatId) throw new Error('missing fields')
      return `tg://${v.botToken}/${v.chatId}`
    },
  },

  discord: {
    label: 'Discord',
    fields: [
      {
        key: 'webhookUrl',
        label: 'Webhook URL',
        placeholder: 'https://discord.com/api/webhooks/…',
        secret: true,
      },
    ],
    build: v => {
      if (!v.webhookUrl) throw new Error('missing webhook URL')
      return v.webhookUrl.startsWith('http')
        ? v.webhookUrl
        : `discord://${v.webhookUrl}`
    },
  },

  slack: {
    label: 'Slack',
    fields: [
      {
        key: 'webhookUrl',
        label: 'Incoming webhook URL',
        placeholder: 'https://hooks.slack.com/services/…',
        secret: true,
      },
    ],
    build: v => {
      if (!v.webhookUrl) throw new Error('missing webhook URL')
      return v.webhookUrl
    },
  },

  gotify: {
    label: 'Gotify',
    pinned: ['host'],
    fields: [{ key: 'token', label: 'App token', placeholder: '…', secret: true }],
    build: (v, pinned) => {
      const host = pinned?.host || v.host
      if (!host || !v.token) throw new Error('missing fields')
      return `gotify://${host}/${v.token}`
    },
  },

  ntfy: {
    label: 'ntfy',
    pinned: ['host'],
    fields: [{ key: 'topic', label: 'Topic', placeholder: 'my-topic' }],
    build: (v, pinned) => {
      const host = pinned?.host || v.host
      if (!host || !v.topic) throw new Error('missing fields')
      return `ntfy://${host}/${v.topic}`
    },
  },

  pushover: {
    label: 'Pushover',
    fields: [
      { key: 'userKey', label: 'User key', placeholder: 'u…', secret: true },
      { key: 'appToken', label: 'App token', placeholder: 'a…', secret: true },
    ],
    build: v => {
      if (!v.userKey || !v.appToken) throw new Error('missing fields')
      return `pushover://${v.userKey}/${v.appToken}`
    },
  },

  nextcloud: {
    label: 'Nextcloud',
    pinned: ['host'],
    fields: [
      { key: 'username', label: 'Username' },
      { key: 'appToken', label: 'App token', secret: true },
    ],
    build: (v, pinned) => {
      const host = pinned?.host || v.host
      if (!host || !v.username || !v.appToken) throw new Error('missing fields')
      return `nextcloud://${v.username}:${v.appToken}@${host}/`
    },
  },

  nextcloudtalk: {
    label: 'Nextcloud Talk',
    pinned: ['host'],
    fields: [
      { key: 'roomId', label: 'Room ID', placeholder: '…' },
      { key: 'token', label: 'Token', secret: true },
    ],
    build: (v, pinned) => {
      const host = pinned?.host || v.host
      if (!host || !v.roomId || !v.token) throw new Error('missing fields')
      return `nextcloudtalk://${v.roomId}:${v.token}@${host}/`
    },
  },

  signal: {
    label: 'Signal (signald)',
    pinned: ['host', 'port'],
    fields: [
      { key: 'login', label: 'Login' },
      { key: 'password', label: 'Password', secret: true },
      { key: 'fromNumber', label: 'Your Signal number', placeholder: '+49…' },
      { key: 'toNumber', label: 'Recipient number', placeholder: '+49…' },
    ],
    build: (v, pinned) => {
      const host = pinned?.host || v.host
      const port = pinned?.port || v.port || 8080
      if (!host || !v.login || !v.password || !v.fromNumber) {
        throw new Error('missing fields')
      }
      const url = `signal://${v.login}:${v.password}@${host}:${port}/${v.fromNumber}`
      return v.toNumber ? `${url}?to=${encodeURIComponent(v.toNumber)}` : url
    },
  },

  whatsapp: {
    label: 'WhatsApp Business',
    fields: [
      { key: 'token', label: 'Meta token', secret: true, placeholder: 'EAAG…' },
      { key: 'fromPhoneId', label: 'From Phone ID', placeholder: '106…' },
      {
        key: 'toNumber',
        label: 'Recipient number(s)',
        placeholder: '49170…',
      },
    ],
    build: v => {
      if (!v.token || !v.fromPhoneId || !v.toNumber) {
        throw new Error('missing fields')
      }
      const targets = String(v.toNumber)
        .split(/[\s,]+/)
        .filter(Boolean)
        .join('/')
      return `whatsapp://${v.token}@${v.fromPhoneId}/${targets}`
    },
  },

  wechat: {
    label: 'WeChat (WeCom)',
    fields: [
      { key: 'corpId', label: 'Corp ID', placeholder: 'ww…' },
      { key: 'corpSecret', label: 'Corp secret', secret: true },
      { key: 'agentId', label: 'Agent ID', placeholder: '1000002' },
      { key: 'toUser', label: 'Recipient', placeholder: '@user  or  @all' },
    ],
    build: v => {
      if (!v.corpId || !v.corpSecret || !v.agentId || !v.toUser) {
        throw new Error('missing fields')
      }
      const target = v.toUser.startsWith('@') ? v.toUser : `@${v.toUser}`
      return `wechat://${v.corpId}:${v.corpSecret}@${v.agentId}/${target}`
    },
  },

  zoom: {
    label: 'Zoom Team Chat',
    fields: [
      {
        key: 'webhookUrl',
        label: 'Incoming webhook URL',
        placeholder: 'https://inbots.zoom.us/incoming/hook/…',
        secret: true,
      },
    ],
    build: v => {
      if (!v.webhookUrl) throw new Error('missing webhook URL')
      return v.webhookUrl
    },
  },

  zulip: {
    label: 'Zulip',
    fields: [
      { key: 'botEmail', label: 'Bot email', placeholder: 'bot@org.zulipchat.com' },
      { key: 'botKey', label: 'Bot key', secret: true },
    ],
    build: v => {
      if (!v.botEmail || !v.botKey) throw new Error('missing fields')
      return `zulip://${v.botEmail}/${v.botKey}`
    },
  },

  webhook: {
    label: 'Generic webhook (JSON)',
    fields: [
      {
        key: 'url',
        label: 'URL',
        placeholder: 'https://your-service.example/hook',
        secret: true,
      },
    ],
    build: v => {
      if (!v.url) throw new Error('missing URL')
      return `json://${v.url}`
    },
  },

  /** Browser push (Web Push / "browser popups"). No user fields: the
   *  settings page stores the browser's PushSubscription. Delivered by the
   *  apprise container's webpush:// handler (VAPID). */
  browserPush: {
    label: 'Browser notifications',
    browserPush: true,
    fields: [],
    build: buildWebPush,
  },

  /** Power-user escape hatch: a raw Apprise URL, untouched. */
  customUrl: {
    label: 'Custom Apprise URL',
    customUrl: true,
    fields: [
      {
        key: 'url',
        label: 'Apprise URL',
        placeholder: 'tg://…, discord://…, mailto://…',
      },
    ],
    build: v => {
      if (!v.url) throw new Error('missing URL')
      return v.url
    },
  },
}

/** Display order on the user page: common channels first. */
export const CATALOG_ORDER = [
  'browserPush',
  'telegram',
  'discord',
  'slack',
  'gotify',
  'ntfy',
  'pushover',
  'nextcloud',
  'nextcloudtalk',
  'signal',
  'whatsapp',
  'wechat',
  'zoom',
  'zulip',
  'webhook',
  'customUrl',
]

export function listChannelTypes() {
  return Object.keys(CATALOG)
}

export function getChannel(type) {
  return CATALOG[type] || null
}

/** Build the Apprise URL for a channel from user values + admin-pinned
 *  values. Throws when required fields are missing. */
export function buildChannelUrl(type, values = {}, pinned = {}) {
  const channel = CATALOG[type]
  if (!channel) throw new Error(`unknown channel type: ${type}`)
  return channel.build(values, pinned)
}

/** Mask secret values for read APIs: '••••' + last 4 chars. */
export function maskChannelValues(type, values = {}, { reveal = false } = {}) {
  const channel = CATALOG[type]
  if (!channel) return values
  if (channel.browserPush) {
    return values.subscription
      ? { subscriptionSet: true, endpointHost: new URL(values.subscription.endpoint).host }
      : { subscriptionSet: false }
  }
  if (reveal) return values
  const masked = {}
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined || value === null) {
      masked[key] = value
      continue
    }
    const field = channel.fields.find(f => f.key === key)
    if (field?.secret && typeof value === 'string' && value.length > 0) {
      const tail = value.slice(-4)
      masked[key] = `••••${tail}`
    } else {
      masked[key] = value
    }
  }
  return masked
}
