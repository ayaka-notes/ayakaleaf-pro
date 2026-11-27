/**
 * Entry preview panel (Phase C capture, PHASE_C_PLAN.md §1.4/§3-C4).
 *
 * Right half of the visual editor split (`.bibtex-list-and-preview` holds
 * the compact C3 list + this panel). Capture names:
 *  - `bibtex-entry-preview-panel(-open|-contained|-overlay)` role=region
 *    aria "Edit reference". `-contained` (default, side-by-side) vs
 *    (SaaS desktop capture: contained panel only).
 *  - Header: "Previous reference" / "Next reference" chevrons (walk the
 *    current parse list, file order) + "Close". Capture shows them disabled
 *    at the ends — we match: prev disabled at index 0, next disabled at
 *    the last index.
 *  - Summary: citation key (bold), title row, author/year meta row
 *    (`bibtex-entry-preview-summary-title/-meta`, capture).
 *  - Actions dropdown (more_vert): Download (whole `.bib` file — OQ-6)
 *    and Delete (single, guarded, W5 single path).
 *  - Warning (only when applicable): `role="alert"` bold "Required fields
 *    missing" + the missing required field names (pure — preview-model).
 *  - body: tablist **Details** / **Abstract**. Details hosts the C2 form in
 *    **inplace** mode (NO footer — OQ-7: commits are flush-on-leave through
 *    the panel's existing guarded write path, same R2/W1/W2/W3 semantics).
 *    Abstract is a textarea `id="ref-abstract"` (capture) that writes the
 *    `abstract` field through the same shared state (the Details form no
 *    longer lists an abstract row — C2).
 *
 * The form is a shared component with the Add dialog (C5 "Enter manually"):
 * one live-state report path (`onFormChange`) per open form, no separate
 * draft store.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import OLIconButton from '@/shared/components/ol/ol-icon-button'
import OLFormLabel from '@/shared/components/ol/ol-form-label'
import {
  OLDropdown,
  OLDropdownMenu,
  OLDropdownItem,
  OLDropdownToggle,
} from '@/shared/components/ol/ol-dropdown-menu'
import BibEntryForm from './bib-entry-form'
import SplitResizer from '../util/split-resizer'
import customLocalStorage from '@/infrastructure/local-storage'
import type { BibEntry } from '../utils/bib-types'
import {
  missingRequiredLabels,
  previewSummary,
} from '../utils/preview-model.ts'

export type BibPreviewProps = {
  /** The current parsed entries (file order — the preview walks this) */
  entries: { id: string }[]
  /** The previewed entry (full BibEntry, from the current parse) */
  entry: BibEntry
  /** Index into `entries` (file order) */
  previewIndex: number
  onPrev: () => void
  onNext: () => void
  /** Close the preview (the panel flushes before calling this) */
  onClose: () => void
  /** Whole-file download (OQ-6) */
  onDownload: () => void
  /** Single-entry delete (confirm modal in the panel) */
  onDelete: () => void
  /** Form live-state report (OQ-7 flush-on-leave bookkeeping) */
  onFormChange: (entry: BibEntry, originalId: string | null) => void
  existingIds: string[]
  canDelete: boolean
  /** localStorage key for the shared list/preview split (R9 item 2). */
  resizerStorageKey?: string
}

export default function BibEntryPreview({
  entries,
  entry,
  previewIndex,
  onPrev,
  onNext,
  onClose,
  onDownload,
  onDelete,
  onFormChange,
  existingIds,
  canDelete,
  resizerStorageKey,
}: BibPreviewProps) {
  const { t } = useTranslation()

  // Tab: 'details' hosts the shared form, 'abstract' the textarea (capture).
  // Live `abstract` value: null = untouched (the parsed value stands, held
  // in the form state). BOTH resets fire whenever a different entry is
  // previewed (lastFormRef holds the last Details-form report: the shared
  // single report path, OQ-7 — one flush-report per open form).
  const [tab, setTab] = useState<'details' | 'abstract'>('details')
  const [abstractLive, setAbstractLive] = useState<string | null>(null)
  const lastFormRef = useRef<{ entry: BibEntry; originalId: string | null } | null>(
    null
  )
  const entryKey = `${entry.type}:${entry.id}`

  // Collapse/expand the reference list (user request 2026-08-30): explicit
  // control instead of (unreliable) narrow-window auto-stacking. Toggled in
  // the header; the layout root (`.bib-editor-panel` / `.library-page-main`)
  // gets `.bibtex-list-collapsed` and the CSS hides the list and gives the
  // preview full width. Persisted per surface (same storage key family as
  // the split resizer).
  const panelRef = useRef<HTMLDivElement | null>(null)
  const collapseKey = `${resizerStorageKey || 'bib'}-listCollapsed`
  const [listCollapsed, setListCollapsed] = useState<boolean>(() => {
    try { return String(customLocalStorage.getItem(collapseKey)) === 'true' } catch { return false }
  })
  const layoutRoot = useCallback((): HTMLElement | null => {
    let el: Element | null = panelRef.current
    while (el) {
      const r = el.closest('.bib-editor-panel, .library-page-main')
      if (r) return r as HTMLElement
      el = el.parentElement
    }
    return null
  }, [])
  // Apply the persisted state on mount (the preview mounts late — after the
  // user clicks a card — so the class must (re)land on the root then).
  useEffect(() => {
    const root = layoutRoot()
    if (root) root.classList.toggle('bibtex-list-collapsed', listCollapsed)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const toggleListCollapsed = useCallback(() => {
    setListCollapsed(c => {
      const next = !c
      const root = layoutRoot()
      if (root) root.classList.toggle('bibtex-list-collapsed', next)
      try { customLocalStorage.setItem(collapseKey, String(next)) } catch {}
      return next
    })
  }, [collapseKey, layoutRoot])
  // A different surface (project vs library) starts fresh: resync when the
  // panel unmounts/remounts on another root.
  const rootIdRef = useRef<Element | null>(null)
  useEffect(() => {
    const root = layoutRoot()
    if (root && rootIdRef.current !== root) {
      rootIdRef.current = root
      root.classList.toggle('bibtex-list-collapsed', listCollapsed)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutRoot])
  // Biome flags the derived key as an over-dep; the ESLint gate (repo
  // convention) does not validate array deps here. The key is the reset
  // condition: a DIFFERENT entry was previewed.
  // biome-ignore lint/correctness/useExhaustiveDependencies: entryKey is the reset key
  useEffect(() => {
    setTab('details')
    setAbstractLive(null)
    lastFormRef.current = null
  }, [entryKey])

  // Compose form report + abstract-override into the one report the panel
  // keeps (formRef) for the flush-on-leave write.
  const report = (formEntry: BibEntry, originalId: string | null) => {
    const fields = { ...formEntry.fields }
    if (abstractLive !== null) {
      if (abstractLive.trim() === '') {
        // emptying the textarea removes the field (write drops empties)
        delete fields.abstract
      } else {
        fields.abstract = abstractLive
      }
    }
    onFormChange({ ...formEntry, fields }, originalId)
  }

  const handleFormChange = (formEntry: BibEntry, originalId: string | null) => {
    lastFormRef.current = {
      entry: {
        type: formEntry.type,
        id: formEntry.id,
        fields: { ...formEntry.fields },
      },
      originalId,
    }
    report(formEntry, originalId)
  }

  const handleAbstractChange = (value: string) => {
    setAbstractLive(value)
    const last = lastFormRef.current
    if (!last) return
    // Re-report with the override (the form itself does not hold it —
    // without this, a flush right after typing would drop the new text).
    report(
      {
        type: last.entry.type,
        id: last.entry.id,
        fields: { ...last.entry.fields },
      },
      last.originalId
    )
  }

  // Pure summary (preview-model.ts): title/who/year rows, capture-exact.
  const summary = useMemo(
    () => previewSummary(entry.fields),
    [entry.fields]
  )

  const missing = useMemo(
    () => missingRequiredLabels(entry.type, entry.fields),
    [entry.type, entry.fields]
  )

  const abstractValue =
    abstractLive !== null ? abstractLive : entry.fields.abstract || ''

  // W2 (§2.7): Esc while typing in a form FIELD = back (close preview).
  // The Details form handles its own fields; the Abstract textarea lives
  // outside that div, so it gets its own scoped handler.
  const handleBodyKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Escape') return
    const el = e.target
    if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
      return
    }
    e.preventDefault()
    e.stopPropagation()
    onClose()
  }

  return (
    // W2 (§2.7): Esc while typing in the Abstract textarea = back (Close).
    // The Details form handles its own fields' Esc; this div targets only
    // the textarea (the same jsx-a11y opt-out as the C2 form).
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      ref={panelRef}
      className={[
        'bibtex-entry-preview-panel',
        'bibtex-entry-preview-panel-contained',
        'bibtex-entry-preview-panel-open',
        listCollapsed ? 'bibtex-entry-preview-panel-full' : null,
      ]
        .filter(Boolean)
        .join(' ')}
      role="region"
      aria-label={t('Edit reference')}
      onKeyDown={handleBodyKeyDown}
    >
      {/* Shared column resizer (R9 item 2): draggable gutter at the panel's
          left edge; project panel and /library share the component and both
          set `--bibtex-split-preview-width` on their layout root. */}
      <SplitResizer storageKey={resizerStorageKey} />
      {/* Header nav (capture: chevrons + Close) */}
      <div className="bibtex-entry-preview-header">
        <div className="bibtex-entry-preview-header-nav">
          <OLIconButton
            icon="chevron_left"
            variant="ghost"
            size="sm"
            accessibilityLabel={t('Previous reference')}
            disabled={previewIndex <= 0}
            onClick={onPrev}
          />
          <OLIconButton
            icon="chevron_right"
            variant="ghost"
            size="sm"
            accessibilityLabel={t('Next reference')}
            disabled={previewIndex >= entries.length - 1}
            onClick={onNext}
          />
          {/* Collapse/expand the reference list (user request 2026-08-30):
              explicit control instead of narrow-window auto-stacking. The
              state lives on the layout root (`.bib-editor-panel` /
              `.library-page-main`) so it survives entry switches and works
              for BOTH surfaces from this one shared component. */}
          <button
            type="button"
            className="icon-button-small btn btn-ghost"
            aria-label={listCollapsed ? t('Expand reference list') : t('Collapse reference list')}
            aria-pressed={listCollapsed}
            title={listCollapsed ? t('Expand reference list') : t('Collapse reference list')}
            onClick={toggleListCollapsed}
          >
            <span className="material-symbols icon-small" aria-hidden="true" translate="no">
              {listCollapsed ? 'chevron_right' : 'chevron_left'}
            </span>
          </button>
        </div>
        <OLIconButton
          icon="close"
          variant="ghost"
          size="sm"
          accessibilityLabel={t('Close')}
          onClick={onClose}
        />
      </div>

      {/* Summary (capture: key bold, title, author/year meta) */}
      <div className="bibtex-entry-preview-summary">
        <div className="bibtex-entry-preview-summary-content">
          <div className="bibtex-entry-preview-summary-key">
            {entry.id || t('Untitled')}
          </div>
          {summary?.title && (
            <div className="bibtex-entry-preview-summary-title">
              {summary.title}
            </div>
          )}
          {(summary?.who || summary?.year) && (
            <div className="bibtex-entry-preview-summary-meta">
              {summary?.who && <span>{summary.who}</span>}
              {summary?.year && <span>{summary.year}</span>}
            </div>
          )}
        </div>
        {/* Actions (capture: more_vert → Download / Delete) */}
        <div className="bibtex-entry-preview-summary-actions dropdown">
          <OLDropdown align="end">
            <OLDropdownToggle
              className="btn-ghost btn-sm bib-preview-actions-toggle"
              aria-label={t('Actions')}
              aria-haspopup="true"
            >
              <span className="material-symbols" aria-hidden="true">
                more_vert
              </span>
            </OLDropdownToggle>
            <OLDropdownMenu>
              <OLDropdownItem leadingIcon="download" onClick={onDownload}>
                {t('Download')}
              </OLDropdownItem>
              <OLDropdownItem
                leadingIcon="delete"
                onClick={onDelete}
                disabled={!canDelete}
              >
                {t('delete')}
              </OLDropdownItem>
            </OLDropdownMenu>
          </OLDropdown>
        </div>
      </div>

      {/* Required-fields warning (capture: role=alert + field names) */}
      {missing.length > 0 && (
        <div role="alert" className="bibtex-entry-preview-warning">
          <span className="material-symbols" aria-hidden="true">
            warning
          </span>
          <div className="bib-preview-warning-content">
            <p className="bib-preview-warning-title">
              <b>{t('Required fields missing')}</b>
            </p>
            <p className="bib-preview-warning-fields">
              {missing.join(', ')}
            </p>
          </div>
        </div>
      )}

      {/* Body (capture: tablist + tabpanels) */}
      <div
        className={[
          'bibtex-entry-preview-body',
          tab === 'abstract' ? 'bibtex-entry-preview-body-abstract' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <div className="bibtex-entry-preview-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            id="bibtex-entry-preview-tab-details"
            aria-controls="bibtex-entry-preview-panel-details"
            aria-selected={tab === 'details'}
            tabIndex={tab === 'details' ? 0 : -1}
            className={[
              'bibtex-entry-preview-tab',
              tab === 'details' ? 'bibtex-entry-preview-tab-active' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            onClick={() => setTab('details')}
          >
            {t('Details')}
          </button>
          <button
            type="button"
            role="tab"
            id="bibtex-entry-preview-tab-abstract"
            aria-controls="bibtex-entry-preview-panel-abstract"
            aria-selected={tab === 'abstract'}
            tabIndex={tab === 'abstract' ? 0 : -1}
            className={[
              'bibtex-entry-preview-tab',
              tab === 'abstract' ? 'bibtex-entry-preview-tab-active' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            onClick={() => setTab('abstract')}
          >
            {t('Abstract')}
          </button>
        </div>
        <div
          role="tabpanel"
          id="bibtex-entry-preview-panel-details"
          aria-labelledby="bibtex-entry-preview-tab-details"
          className={[
            'bibtex-entry-preview-panel-details',
            tab !== 'details' ? 'bibtex-entry-preview-panel-hidden' : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <BibEntryForm
            entry={entry}
            kind="existing"
            originalId={entry.id}
            existingIds={existingIds}
            onFormChange={handleFormChange}
            onBack={onClose}
            variant="inplace"
          />
        </div>
        <div
          role="tabpanel"
          id="bibtex-entry-preview-panel-abstract"
          aria-labelledby="bibtex-entry-preview-tab-abstract"
          className={[
            'bibtex-entry-preview-panel-abstract',
            tab !== 'abstract' ? 'bibtex-entry-preview-panel-hidden' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          hidden={tab !== 'abstract'}
        >
          <div className="bibtex-abstract-form-group">
            <OLFormLabel htmlFor="ref-abstract">
              {t('Abstract')}
            </OLFormLabel>
            <textarea
              id="ref-abstract"
              className="bibtex-abstract-textarea"
              rows={6}
              value={abstractValue}
              onChange={(event) => handleAbstractChange(event.target.value)}
              placeholder={t('Abstract')}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
