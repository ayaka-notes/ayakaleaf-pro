import React, { useCallback, useEffect, useState } from 'react'
import { Form } from 'react-bootstrap'
import OLButton from '@/shared/components/ol/ol-button'
import OLFormText from '@/shared/components/ol/ol-form-text'
import MaterialIcon from '@/shared/components/material-icon'
import getMeta from '@/utils/meta'
import { postJSON } from '@/infrastructure/fetch-json'
import { debugConsole } from '@/utils/debugging'

type Recipient = {
  id: string
  email: string
  notificationUrl: string | null
}

type State = {
  dispatch: {
    apiUrl: string
    dryRun: boolean
    baseDelayMs: number
  }
  recipients: Recipient[]
  queue: {
    pending: number
    processing: number
    dead: number
    recent: Record<string, unknown>[]
  }
}

function initialState(): State {
  const meta = getMeta('ol-notificationsAdmin')
  if (meta && typeof meta === 'object' && 'dispatch' in meta) {
    return meta as State
  }
  return {
    dispatch: { apiUrl: '', dryRun: false, baseDelayMs: 120000 },
    recipients: [],
    queue: { pending: 0, processing: 0, dead: 0, recent: [] },
  }
}

function delayLabel(ms: number): string {
  if (ms % 60000 === 0) return `${ms / 60000} min`
  if (ms % 1000 === 0) return `${ms / 1000} s`
  return `${ms} ms`
}

function ToggleButton({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      className={`na-toggle${checked ? ' na-toggle-checked' : ''}`}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="na-toggle-track">
        <span className="na-toggle-thumb" />
      </span>
      <span className="na-toggle-label">{label}</span>
    </button>
  )
}

function NotificationsAdminPage() {
  const [state, setState] = useState<State>(initialState)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [testEmail, setTestEmail] = useState('')
  const [testUrl, setTestUrl] = useState('')
  const [urlDrafts, setUrlDrafts] = useState<Record<string, string>>({})

  const act = useCallback(
    async (key: string, endpoint: string, payload: unknown, after?: (data: any) => void) => {
      setBusy(key)
      setMessage(null)
      try {
        const data = await postJSON(endpoint, { body: payload })
        if (after) after(data)
        setMessage({ kind: 'ok', text: 'Done.' })
      } catch (err: any) {
        const text =
          err?.response?.data?.message || err?.message || 'Request failed'
        setMessage({ kind: 'err', text })
        debugConsole.error(err)
      } finally {
        setBusy(null)
      }
    },
    []
  )

  const refresh = useCallback(async () => {
    try {
      // State endpoint (POST + CSRF, house convention)
      const res = await fetch('/admin/notifications/state', { method: 'POST' })
      const data = await res.json()
      if (data && 'dispatch' in data) setState(data)
    } catch (err) {
      debugConsole.error(err)
    }
  }, [])

  // Prefetch the freshest state (the SSR meta may be a few moments stale;
  // the meta still gives a useful first paint).
  useEffect(() => {
    refresh()
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        refresh()
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refresh])

  const setDryRun = (value: boolean) =>
    act('dry-run', '/admin/notifications/dry-run', { dryRun: value }, () =>
      setState(s => ({ ...s, dispatch: { ...s.dispatch, dryRun: value } }))
    )

  const saveUserUrl = (recipient: Recipient) => {
    const value = (urlDrafts[recipient.id] ?? recipient.notificationUrl ?? '').trim()
    act(`url-${recipient.id}`, '/admin/notifications/user-url', {
      userId: recipient.id,
      notificationUrl: value || null,
    }, () =>
      setState(s => ({
        ...s,
        recipients: s.recipients.map(r =>
          r.id === recipient.id ? { ...r, notificationUrl: value || null } : r
        ),
      }))
    )
  }

  const testUser = (recipient: Recipient) =>
    act(
      `test-${recipient.id}`,
      '/admin/notifications/test',
      { userId: recipient.id, email: recipient.email }
    )

  const testChannel = () =>
    act(
      'test-channel',
      '/admin/notifications/test',
      {
        email: testEmail.trim() || undefined,
        url: testUrl.trim() || undefined,
      }
    )

  const CHANNEL_LABELS: Record<string, string> = {
    browserPush: 'Browser notifications (Web Push)',
    telegram: 'Telegram',
    discord: 'Discord',
    slack: 'Slack',
    gotify: 'Gotify',
    ntfy: 'ntfy',
    pushover: 'Pushover',
    nextcloud: 'Nextcloud',
    nextcloudtalk: 'Nextcloud Talk',
    signal: 'Signal (signald)',
    whatsapp: 'WhatsApp Business',
    wechat: 'WeChat (WeCom)',
    zoom: 'Zoom Team Chat',
    zulip: 'Zulip',
    webhook: 'Generic webhook',
    customUrl: 'Custom Apprise URL',
  }

  const PINNABLE = {
    gotify: ['host'],
    ntfy: ['host'],
    nextcloud: ['host'],
    nextcloudtalk: ['host'],
    signal: ['host', 'port'],
  }

  const ALL_CHANNEL_TYPES = [
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

  const isChannelEnabled = (type: string) => {
    if (type in channelDraft.enabled) return channelDraft.enabled[type]
    return (state.channels?.enabled || []).includes(type)
  }

  const saveChannels = () => {
    const finalEnabled = ALL_CHANNEL_TYPES.filter(
      t =>
        t in channelDraft.enabled
          ? channelDraft.enabled[t]
          : (state.channels?.enabled || []).includes(t),
    )
    act('channels', '/admin/notifications/channels', {
      enabledChannelTypes: finalEnabled,
      pinned: channelDraft.pinned,
    })
  }

  return (
    <div className="container na-notifications-admin">
      <div className="na-header">
        <h1 className="na-header-title">
          <MaterialIcon type="campaign" />
          Notifications
        </h1>
        <p className="na-header-desc">
          Project-activity notifications are dispatched through the Apprise API,
          so every recipient can choose their own channel (email by default, or
          Telegram, Discord, ntfy, …).
        </p>
      </div>

      {message ? (
        <div
          className={`na-status na-status-${message.kind}`}
          role={message.kind === 'err' ? 'alert' : 'status'}
        >
          {message.text}
        </div>
      ) : null}

      {/* 1 — channel types */}
      <div className="na-section">
        <div className="na-section-header">
          <span className="na-section-main">
            <span className="na-badge">1</span>
            Channel types
          </span>
          <span className="na-queue-actions">
            <OLButton
              variant="secondary"
              size="sm"
              disabled={busy === 'channels'}
              onClick={saveChannels}
              data-testid="na-channels-save"
            >
              Save channels
            </OLButton>
          </span>
        </div>
        <div className="na-section-desc">
          Which channels users can set up on their notification-preferences
          page. Pinned values are fixed for all users (e.g. the Gotify/ntfy
          server) and shown read-only there.
        </div>
        <div className="na-section-body">
          <div className="na-channels-grid">
            {ALL_CHANNEL_TYPES.map(type => (
              <div key={type} className="na-channel-item" data-channel-type={type}>
                <label className="na-channel-label">
                  <input
                    type="checkbox"
                    checked={isChannelEnabled(type)}
                    onChange={e =>
                      setChannelDraft(d => ({
                        ...d,
                        enabled: { ...d.enabled, [type]: e.target.checked },
                      }))
                    }
                    data-testid={`na-channel-${type}`}
                  />
                  <span>{CHANNEL_LABELS[type]}</span>
                </label>
                {PINNABLE[type]?.map(field => (
                  <div key={field} className="na-channel-pin">
                    <span className="na-channel-pin-label">{field}</span>
                    <Form.Control
                      size="sm"
                      value={
                        channelDraft.pinned[type]?.[field] ??
                        state.channels?.pinned[type]?.[field] ??
                        ''
                      }
                      onChange={e =>
                        setChannelDraft(d => ({
                          ...d,
                          pinned: {
                            ...d.pinned,
                            [type]: {
                              ...(d.pinned[type] || {}),
                              [field]: e.target.value,
                            },
                          },
                        }))
                      }
                      placeholder={field === 'host' ? 'e.g. gotify.example.org' : ''}
                      data-testid={`na-channel-pin-${type}-${field}`}
                    />
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 2 — dispatch config */}
      <div className="na-section">
        <div className="na-section-header">
          <span className="na-section-main">
            <span className="na-badge">2</span>
            Dispatch
          </span>
        </div>
        <div className="na-section-desc">
          Apprise API: <code>{state.dispatch.apiUrl}</code> · minimum debounce{' '}
          {delayLabel(state.dispatch.baseDelayMs)} (environment configured).
        </div>
        <div className="na-section-body">
          <div className="na-row">
            <ToggleButton
              checked={state.dispatch.dryRun}
              onChange={setDryRun}
              label="Dry run (queue but do not deliver)"
              disabled={busy === 'dry-run'}
            />
          </div>

          <div className="na-test-row">
            <div className="na-test-fields">
              <Form.Control
                value={testEmail}
                onChange={e => setTestEmail(e.target.value)}
                placeholder="anyone@example.com"
                data-testid="na-test-email"
              />
              <Form.Control
                value={testUrl}
                onChange={e => setTestUrl(e.target.value)}
                placeholder="or an Apprise URL: tg://…, ntfy://…, discord://…"
                data-testid="na-test-url"
              />
              <OLFormText marginless>
                Send a one-off test notification to either of the above.
              </OLFormText>
            </div>
            <OLButton
              variant="secondary"
              leadingIcon="send"
              disabled={busy === 'test-channel'}
              onClick={testChannel}
              data-testid="na-test-send"
            >
              Send test
            </OLButton>
          </div>
        </div>
      </div>

      {/* 3 — recipients */}
      <div className="na-section">
        <div className="na-section-header">
          <span className="na-section-main">
            <span className="na-badge">3</span>
            Recipients
            <span className="na-count">{state.recipients.length}</span>
          </span>
        </div>
        <div className="na-section-desc">
          Per-user channel override. Empty = the user&apos;s account email. Any
          Apprise URL is accepted.
        </div>
        <div className="na-section-body">
          <div className="na-recipients">
            {state.recipients.map(r => (
              <div key={r.id} className="na-recipient" data-recipient-id={r.id}>
                <div className="na-recipient-email">{r.email}</div>
                <div className="na-recipient-url">
                  <Form.Control
                    value={urlDrafts[r.id] ?? r.notificationUrl ?? ''}
                    onChange={e =>
                      setUrlDrafts(d => ({ ...d, [r.id]: e.target.value }))
                    }
                    placeholder="mailto://… or tg://… (empty = email)"
                    data-testid={`na-recipient-url-${r.id}`}
                  />
                </div>
                <div className="na-recipient-actions">
                  <OLButton
                    variant="secondary"
                    size="sm"
                    disabled={busy === `url-${r.id}`}
                    onClick={() => saveUserUrl(r)}
                    data-testid={`na-recipient-save-${r.id}`}
                  >
                    Save
                  </OLButton>
                  <OLButton
                    variant="secondary"
                    size="sm"
                    leadingIcon="send"
                    disabled={busy === `test-${r.id}`}
                    onClick={() => testUser(r)}
                    data-testid={`na-recipient-test-${r.id}`}
                  >
                    Test
                  </OLButton>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 4 — queue */}
      <div className="na-section">
        <div className="na-section-header">
          <span className="na-section-main">
            <span className="na-badge">4</span>
            Queue
          </span>
          <span className="na-queue-actions">
            <OLButton
              variant="secondary"
              size="sm"
              leadingIcon="refresh"
              disabled={busy === 'refresh'}
              onClick={() =>
                act('refresh', '/admin/notifications/state', {}, data => {
                  if (data && 'dispatch' in data) setState(data)
                })
              }
            >
              Refresh
            </OLButton>
            <OLButton
              variant="secondary"
              size="sm"
              disabled={busy === 'retry'}
              onClick={() => act('retry', '/admin/notifications/queue/retry', {}, refresh)}
              data-testid="na-queue-retry"
            >
              Retry failed
            </OLButton>
            <OLButton
              variant="danger-ghost"
              size="sm"
              disabled={busy === 'clear'}
              onClick={() => act('clear', '/admin/notifications/queue/clear', {}, refresh)}
              data-testid="na-queue-clear"
            >
              Clear queue
            </OLButton>
          </span>
        </div>
        <div className="na-section-desc">
          Pending {state.queue.pending} · in flight {state.queue.processing} ·
          dead {state.queue.dead}. Failed items back off exponentially and are
          dead-lettered after 3 attempts.
        </div>
        <div className="na-section-body">
          {state.queue.recent.length === 0 ? (
            <OLFormText marginless>Queue is empty — nothing scheduled yet.</OLFormText>
          ) : (
            <div className="na-recent">
              {state.queue.recent.map((doc, idx) => (
                <div key={idx} className="na-recent-row">
                  <span className="na-recent-project">
                    {(doc.opts as any)?.projectName || (doc.project_id as string) || '—'}
                  </span>
                  <span className="na-recent-status">
                    {doc.dead
                      ? 'dead'
                      : doc.processing
                        ? 'processing'
                        : (doc.nextRetryAt as string)
                          ? 'backoff'
                          : 'pending'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default NotificationsAdminPage
