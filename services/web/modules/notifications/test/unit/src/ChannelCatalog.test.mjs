import { describe, expect, it } from 'vitest'
import {
  buildChannelUrl,
  maskChannelValues,
  listChannelTypes,
} from '../../../app/src/ChannelCatalog.mjs'

describe('ChannelCatalog', function () {
  it('lists all expected channel types', () => {
    const types = listChannelTypes()
    for (const expected of [
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
      'browserPush',
      'customUrl',
    ]) {
      expect(types).toContain(expected)
    }
  })

  it('builds telegram URL', () => {
    expect(buildChannelUrl('telegram', { botToken: 'TOK', chatId: '123' })).toBe(
      'tg://TOK/123'
    )
  })

  it('builds gotify URL with pinned host', () => {
    expect(
      buildChannelUrl('gotify', { token: 'abc' }, { host: 'gotify.example.org' })
    ).toBe('gotify://gotify.example.org/abc')
  })

  it('builds ntfy URL with pinned host', () => {
    expect(
      buildChannelUrl('ntfy', { topic: 'mytopic' }, { host: 'ntfy.example.org' })
    ).toBe('ntfy://ntfy.example.org/mytopic')
  })

  it('builds nextcloud URL', () => {
    expect(
      buildChannelUrl('nextcloud', {
        username: 'jane',
        appToken: 'tok',
      }, { host: 'cloud.example.org' })
    ).toBe('nextcloud://jane:tok@cloud.example.org/')
  })

  it('builds nextcloudtalk URL', () => {
    expect(
      buildChannelUrl('nextcloudtalk', {
        roomId: 'room1',
        token: 'tok',
      }, { host: 'cloud.example.org' })
    ).toBe('nextcloudtalk://room1:tok@cloud.example.org/')
  })

  it('builds signal URL with pinned host/port and target', () => {
    expect(
      buildChannelUrl('signal', {
        login: 'jane',
        password: 'pw',
        fromNumber: '+49170123',
        toNumber: '+49170456',
      }, { host: 'signald.example.org', port: '8081' })
    ).toBe(
      'signal://jane:pw@signald.example.org:8081/+49170123?to=%2B49170456'
    )
  })

  it('builds whatsapp URL with multiple targets', () => {
    expect(
      buildChannelUrl('whatsapp', {
        token: 'EAAG',
        fromPhoneId: '106',
        toNumber: '49170123 49170456',
      })
    ).toBe('whatsapp://EAAG@106/49170123/49170456')
  })

  it('builds wechat URL with @-prefixed target', () => {
    expect(
      buildChannelUrl('wechat', {
        corpId: 'ww123',
        corpSecret: 'sec',
        agentId: '1000002',
        toUser: 'user1',
      })
    ).toBe('wechat://ww123:sec@1000002/@user1')
  })

  it('builds zulip URL', () => {
    expect(
      buildChannelUrl('zulip', {
        botEmail: 'bot@org.zulipchat.com',
        botKey: 'key',
      })
    ).toBe('zulip://bot@org.zulipchat.com/key')
  })

  it('builds webhook URL as json:// scheme', () => {
    expect(
      buildChannelUrl('webhook', { url: 'https://example.com/hook' })
    ).toBe('json://https://example.com/hook')
  })

  it('passes through discord and slack webhook URLs', () => {
    expect(
      buildChannelUrl('discord', {
        webhookUrl: 'https://discord.com/api/webhooks/1/2',
      })
    ).toBe('https://discord.com/api/webhooks/1/2')
    expect(
      buildChannelUrl('slack', {
        webhookUrl: 'https://hooks.slack.com/services/T/B/X',
      })
    ).toBe('https://hooks.slack.com/services/T/B/X')
  })

  it('builds browser push URL with base64url subscription', () => {
    const sub = {
      endpoint: 'https://push.example.org/sub/1',
      keys: { p256dh: 'key', auth: 'auth' },
    }
    const url = buildChannelUrl('browserPush', { subscription: sub })
    expect(url.startsWith('webpush://')).toBe(true)
    const decoded = JSON.parse(
      Buffer.from(url.slice('webpush://'.length), 'base64url').toString()
    )
    expect(decoded.endpoint).toBe(sub.endpoint)
  })

  it('throws on missing required fields', () => {
    expect(() => buildChannelUrl('telegram', {})).toThrow()
    expect(() => buildChannelUrl('gotify', { token: 't' })).toThrow()
  })

  it('masks secret values', () => {
    const masked = maskChannelValues('telegram', {
      botToken: 'secret1234',
      chatId: '42',
    })
    expect(masked.botToken).toMatch(/^••••1234$/)
    expect(masked.chatId).toBe('42')
  })

  it('masks browser push subscription details', () => {
    const masked = maskChannelValues('browserPush', {
      subscription: {
        endpoint: 'https://push.example.org/sub/1',
        keys: { p256dh: 'k', auth: 'a' },
      },
    })
    expect(masked.subscriptionSet).toBe(true)
    expect(masked.endpointHost).toBe('push.example.org')
    expect(masked.subscription).toBeUndefined()
  })

  it('passes customUrl through unchanged', () => {
    expect(
      buildChannelUrl('customUrl', { url: 'mailto://x@y.z' })
    ).toBe('mailto://x@y.z')
  })

  it('throws for unknown type', () => {
    expect(() => buildChannelUrl('nope', {})).toThrow()
  })
})
