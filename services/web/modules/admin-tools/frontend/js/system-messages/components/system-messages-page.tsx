import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Form } from 'react-bootstrap'
import OLButton from '@/shared/components/ol/ol-button'
import OLFormLabel from '@/shared/components/ol/ol-form-label'
import OLFormText from '@/shared/components/ol/ol-form-text'
import OLCloseButton from '@/shared/components/ol/ol-close-button'
import MaterialIcon from '@/shared/components/material-icon'
import getMeta from '@/utils/meta'
import {
  postJSON,
  patchJSON,
  deleteJSON,
} from '@/infrastructure/fetch-json'
import { SystemMessage } from '../../../../../../types/system-message'
import {
  PLACEMENT_OPTIONS,
  normalizePlacementsChecked,
} from '@/shared/components/system-message-surface'

type CheckedMap = Record<string, boolean>

type Toast = {
  type: 'success' | 'error' | 'info'
  text: string
}

/** The page lists the real DB messages (meta-prefetched by the server). */
function initialMessages(): SystemMessage[] {
  const meta = getMeta('ol-systemMessages')
  return Array.isArray(meta) ? (meta as SystemMessage[]) : []
}

function placementsToChecked(placements?: string[]): CheckedMap {
  const all = !placements || placements.length === 0
  return {
    all,
    editor: !all && placements!.includes('editor'),
    hub: !all && placements!.includes('hub'),
    auth: !all && placements!.includes('auth'),
  }
}

function applyToggle(prev: CheckedMap, value: string): CheckedMap {
  if (value === 'all') {
    // already 'All pages' → checkbox is a no-op (empty selection means 'all')
    if (prev.all) return prev
    return { all: true, editor: false, hub: false, auth: false }
  }
  if (prev.all) {
    // switch out of 'all' into concrete surfaces
    return {
      all: false,
      editor: value === 'editor',
      hub: value === 'hub',
      auth: value === 'auth',
    }
  }
  const next: CheckedMap = { ...prev, [value]: !prev[value] }
  if (!next.editor && !next.hub && !next.auth) {
    // at least one surface must stay on; "nothing" maps back to 'all'
    next.all = true
  }
  return next
}

/**
 * Checkbox chips: All pages (exclusive) / Editor / Workspace & admin /
 * Login & register. Each option keeps its own text label as accessible name.
 */
function PlacementChips({
  checked,
  onToggle,
  disabled,
  ariaBase,
  chipLabel,
}: {
  checked: CheckedMap
  onToggle: (value: string) => void
  disabled?: boolean
  ariaBase?: string
  chipLabel?: string
}) {
  return (
    <div
      className="sm-placement-chips"
      role="group"
      aria-label={ariaBase || chipLabel || 'Placement'}
    >
      {/* Chips are plain buttons (role="checkbox"), not <label>-wrapped
          checkboxes: a label click on a controlled react-bootstrap checkbox
          double-activates in Chromium and cancels the toggle. A button
          gives one unambiguous click = one toggle, with full keyboard/a11y
          support via role="checkbox" + aria-checked. */}
      {PLACEMENT_OPTIONS.map(opt => (
        <React.Fragment key={opt.value}>
          <button
            type="button"
            role="checkbox"
            aria-checked={!!checked[opt.value]}
            aria-label={`Placement: ${opt.label}`}
            disabled={disabled}
            className={`sm-placement-chip${!!checked[opt.value] ? ' is-on' : ''}`}
            onClick={() => onToggle(opt.value)}
          >
            <span className="sm-placement-chip-icon" aria-hidden="true">
              {checked[opt.value] ? '✓' : ''}
            </span>
            {opt.label}
          </button>
          {/* 'All pages' is the exclusive option: give it its own row and
              keep the three surface chips together on the next line. */}
          {opt.value === 'all' ? (
            <span className="sm-chip-row-break" aria-hidden="true" />
          ) : null}
        </React.Fragment>
      ))}
    </div>
  )
}

const REFRESH_INTERVAL = 30 * 1000

function errorMessageFor(err: unknown, fallback: string) {
  const e = err as { message?: string; getUserFacingMessage?: () => string }
  if (e && typeof e.getUserFacingMessage === 'function') {
    try {
      const m = e.getUserFacingMessage()
      if (m) return m
    } catch {
      // fall through
    }
  }
  return (e && e.message) || fallback
}

function SystemMessagesPage() {
  const [messages, setMessages] = useState<SystemMessage[]>(initialMessages)
  const [content, setContent] = useState('')
  const [newChecked, setNewChecked] = useState<CheckedMap>(() =>
    placementsToChecked(undefined)
  )
  // #17d: optional per-message "unremovable" flag for new messages
  const [newUnremovable, setNewUnremovable] = useState(false)
  const [busy, setBusy] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [toast, setToast] = useState<Toast | null>(null)

  // Live refresh: 30 s heartbeat + refetch when the tab becomes visible.
  const refetch = useCallback(async () => {
    try {
      // house convention: admin JSON lists are POST (CSRF-protected)
      const d = await postJSON<SystemMessage[]>('/admin/messages/list', {
        body: {},
      })
      if (Array.isArray(d)) {
        setMessages(d)
        setLastUpdated(new Date())
      }
    } catch {
      // non-critical: keep the current list
    }
  }, [])

  useEffect(() => {
    refetch()
    const interval = setInterval(refetch, REFRESH_INTERVAL)
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void refetch()
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refetch])

  // Clear-all is destructive: second click within 4 s confirms.
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handleClearClick = () => {
    if (!confirmClear) {
      setConfirmClear(true)
      confirmTimer.current = setTimeout(() => setConfirmClear(false), 4000)
      return
    }
    if (confirmTimer.current) clearTimeout(confirmTimer.current)
    void clearAll()
  }

  const add = async () => {
    const text = content.trim()
    if (!text) return
    setBusy(true)
    try {
      const { placements } = normalizePlacementsChecked(newChecked)
      await postJSON('/admin/messages', {
        body: {
          content: text,
          placements,
          unremovable: newUnremovable,
        },
      })
      setContent('')
      setNewChecked(placementsToChecked(undefined))
      setNewUnremovable(false)
      setToast({ type: 'success', text: 'System message added.' })
      await refetch()
    } catch (err) {
      setToast({
        type: 'error',
        text: errorMessageFor(err, 'Could not add the message.'),
      })
    } finally {
      setBusy(false)
    }
  }

  const clearAll = async () => {
    setConfirmClear(false)
    setBusy(true)
    try {
      await postJSON('/admin/messages/clear', { body: {} })
      setMessages([])
      setLastUpdated(new Date())
      setToast({ type: 'success', text: 'All system messages cleared.' })
    } catch (err) {
      setToast({
        type: 'error',
        text: errorMessageFor(err, 'Could not clear the messages.'),
      })
    } finally {
      setBusy(false)
    }
  }

  const onSaved = () => {
    setToast({ type: 'success', text: 'Message placement updated.' })
    void refetch()
  }

  const onUnremovableChanged = () => {
    setToast({
      type: 'success',
      text: 'Dismiss option updated.',
    })
    void refetch()
  }

  const onDeleted = () => {
    setToast({ type: 'success', text: 'Message deleted.' })
    void refetch()
  }

  return (
    <div className="container sm-system-messages">
      <div className="sm-system-messages-header">
        <h1 className="sm-system-messages-header-title">
          <MaterialIcon type="campaign" />
          System messages
        </h1>
        <p className="sm-system-messages-header-desc">
          Banner messages shown to users of this instance. Choose where each
          message is shown — all pages, or a specific surface (Editor,
          workspace &amp; admin, login &amp; register). Legacy messages
          without a placement stay visible everywhere.
        </p>
      </div>

      {toast ? (
        <Alert
          variant={toast.type === 'success' ? 'success' : 'danger'}
          className="sm-system-messages-toast"
          data-testid="sm-toast"
        >
          {toast.type === 'success' ? (
            <MaterialIcon type="check_circle" className="me-1" />
          ) : (
            <MaterialIcon type="error" className="me-1" />
          )}
          {toast.text}
        </Alert>
      ) : null}

      <div className="sm-settings-section">
        <div className="sm-settings-section-header">
          <span className="sm-settings-section-badge">1</span>
          Add a message
        </div>
        <div className="sm-settings-section-desc">
          The message appears immediately for users on the selected surfaces.
        </div>
        <div className="sm-settings-section-body">
          <OLFormLabel htmlFor="sm-new-message" className="mb-2">
            Message
          </OLFormLabel>
          <div className="sm-add-row">
            <Form.Control
              id="sm-new-message"
              type="text"
              value={content}
              placeholder="e.g. Maintenance window on Sunday 02:00–04:00 UTC"
              className="sm-add-input"
              onChange={e => setContent(e.currentTarget.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void add()
                }
              }}
            />
            <OLButton
              variant="primary"
              leadingIcon="add"
              isLoading={busy}
              onClick={() => void add()}
              data-testid="sm-add"
            >
              Add message
            </OLButton>
          </div>
          <OLFormText className="sm-placement-label" marginless>
            <MaterialIcon type="info" className="me-1" />
            Where new messages are shown:
          </OLFormText>
          <PlacementChips
            checked={newChecked}
            disabled={busy}
            ariaBase="Where new messages are shown"
            onToggle={value => setNewChecked(prev => applyToggle(prev, value))}
          />
          <OLFormText className="sm-placement-hint">
            Messages left on “All pages” keep the legacy behavior: visible
            everywhere, including the editor, workspace and login pages.
          </OLFormText>
          <div className="sm-unremovable-toggle">
            <OLFormText className="sm-placement-sublabel" marginless>
              Dismissable by users:
            </OLFormText>
            <button
              type="button"
              role="switch"
              aria-checked={!newUnremovable}
              disabled={busy}
              className={`sm-placement-chip${newUnremovable ? ' is-on' : ''}`}
              onClick={() => setNewUnremovable(v => !v)}
            >
              <span className="sm-placement-chip-icon" aria-hidden="true">
                {newUnremovable ? '✓' : ''}
              </span>
              {newUnremovable
                ? 'No — unremovable (hide the X button)'
                : 'Yes — users can close the banner'}
            </button>
          </div>
          <OLFormText className="sm-placement-hint">
            Unremovable messages (e.g. outages) stay visible until an admin
            removes them — users cannot dismiss them with the X button.
          </OLFormText>
        </div>
      </div>

      <div className="sm-settings-section">
        <div className="sm-settings-section-header sm-settings-section-header-actions">
          <span className="sm-settings-section-header-main">
            <span className="sm-settings-section-badge">2</span>
            Current messages
            {messages.length > 0 ? (
              <span className="sm-section-count">{messages.length}</span>
            ) : null}
          </span>
          {messages.length > 0 ? (
            <OLButton
              variant="danger-outline"
              leadingIcon="delete"
              size="sm"
              disabled={busy}
              className={confirmClear ? 'sm-clear-confirm' : undefined}
              onClick={handleClearClick}
              data-testid={confirmClear ? 'sm-clear-confirm' : 'sm-clear'}
            >
              {confirmClear ? 'Confirm clear all' : 'Clear all'}
            </OLButton>
          ) : null}
        </div>
        <div className="sm-settings-section-desc">
          Shown to users on the right-hand surfaces. This list auto-refreshes
          every 30 s while the page is open
          {lastUpdated ? (
            <>
              {' '}
              (last updated {lastUpdated.toLocaleTimeString()})
            </>
          ) : null}
          .
        </div>
        <div className="sm-settings-section-body">
          {messages.length > 0 ? (
            <div className="sm-message-list">
              {messages.map((m, idx) => (
                <MessageRow
                  key={m._id || idx}
                  message={m}
                  afterSaved={onSaved}
                  afterDeleted={onDeleted}
                  afterUnremovableChanged={onUnremovableChanged}
                />
              ))}
            </div>
          ) : (
            <OLFormText className="sm-empty">
              No system messages are currently set.
            </OLFormText>
          )}
        </div>
      </div>
    </div>
  )
}

function MessageRow({
  message,
  afterSaved,
  afterDeleted,
  afterUnremovableChanged,
}: {
  message: SystemMessage
  afterSaved: () => void
  afterDeleted: () => void
  afterUnremovableChanged: () => void
}) {
  const [checked, setChecked] = useState<CheckedMap>(() =>
    placementsToChecked(message.placements)
  )
  // #17d: per-message dismiss control
  const [unremovable, setUnremovable] = useState<boolean>(
    message.unremovable === true
  )
  const [busy, setBusy] = useState(false)
  const [rowError, setRowError] = useState<string | null>(null)

  const toggle = async (value: string) => {
    const next = applyToggle(checked, value)
    if (next[value] === checked[value]) return
    setChecked(next)
    const { placements } = normalizePlacementsChecked(next)
    if (!message._id) return
    setBusy(true)
    setRowError(null)
    try {
      await patchJSON(`/admin/messages/${encodeURIComponent(message._id)}`, {
        body: { placements },
      })
      afterSaved()
    } catch (err) {
      // roll back local state on failure
      setChecked(checked)
      setRowError(errorMessageFor(err, 'Could not update the placement.'))
    } finally {
      setBusy(false)
    }
  }

  // #17d: toggle whether users may dismiss the banner (hide/show the X).
  const toggleUnremovable = async () => {
    if (!message._id) return
    const next = !unremovable
    setUnremovable(next)
    setBusy(true)
    setRowError(null)
    try {
      await patchJSON(
        `/admin/messages/${encodeURIComponent(message._id)}`,
        { body: { unremovable: next } }
      )
      afterUnremovableChanged()
    } catch (err) {
      setUnremovable(!next)
      setRowError(errorMessageFor(err, 'Could not update the message.'))
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!message._id) return
    setBusy(true)
    setRowError(null)
    try {
      await deleteJSON(
        `/admin/messages/${encodeURIComponent(message._id)}`
      )
      afterDeleted()
    } catch (err) {
      setRowError(errorMessageFor(err, 'Could not delete the message.'))
    } finally {
      setBusy(false)
    }
  }

  const shownLabel = checked.all
    ? 'All pages'
    : PLACEMENT_OPTIONS.filter(o => o.value !== 'all' && checked[o.value])
        .map(o => o.label)
        .join(' + ')

  return (
    <div className="sm-message-row" data-sm-message-id={message._id || undefined}>
      <div className="sm-message-row-top">
        <OLFormText className="sm-message-content" marginless>
          {message.content}
        </OLFormText>
        <OLCloseButton
          aria-label={`Delete message: ${String(message.content || 'message').slice(0, 40)}`}
          className="sm-message-delete"
          disabled={busy}
          onClick={() => void remove()}
          data-testid={
            message._id ? `sm-delete-${message._id}` : 'sm-delete'
          }
        />
      </div>
      <div className="sm-message-row-bottom">
        <OLFormText className="sm-placement-sublabel" marginless>
          Shown on:
        </OLFormText>
        <PlacementChips
          checked={checked}
          disabled={busy}
          ariaBase={`Message placement: ${shownLabel}`}
          onToggle={value => void toggle(value)}
        />
      </div>
      <div className="sm-message-row-bottom sm-unremovable-row">
        <OLFormText className="sm-placement-sublabel" marginless>
          Dismiss:
        </OLFormText>
        <button
          type="button"
          role="switch"
          aria-checked={!unremovable}
          disabled={busy}
          className={`sm-placement-chip${unremovable ? ' is-on' : ''}`}
          onClick={() => void toggleUnremovable()}
        >
          <span className="sm-placement-chip-icon" aria-hidden="true">
            {unremovable ? '✓' : ''}
          </span>
          {unremovable
            ? 'Unremovable (no X button)'
            : 'Users can close it (X button)'}
        </button>
      </div>
      {rowError ? (
        <OLFormText type="error" className="sm-message-error" marginless>
          {rowError}
        </OLFormText>
      ) : null}
    </div>
  )
}

export default SystemMessagesPage
