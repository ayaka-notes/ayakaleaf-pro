/**
 * List of BibTeX entries shown in the visual editor (Phase C capture,
 * PHASE_C_PLAN.md §1.3/§3-C3).
 *
 * Compact windowed rows (capture `bibtex-entry-card-*` BEM), each with:
 *  - checkbox (`bibtex-entry-card-checkbox`, aria "Select entry")
 *  - citation key (`bibtex-entry-card-key`)
 *  - persistent error icon (`bibtex-entry-error-icon`, aria
 *    "Entry has errors") — per-entry required-field check, no Check press
 *  - compact details line (author / title / year)
 * Bulk bar: select-all (`bibtex-bulk-actions-select-all`, aria
 * "Select all entries") + count ("N reference(s)", `{ count }`).
 * Search placeholder is DYNAMIC: "Search <openDocName>" (capture).
 *
 * Rows: capture card-row classes (`bibtex-entry-card-row`, `data-index`,
 * `role=listitem`) rendered in normal flow (content-height rows; the
 * virtual-list.ts math stays available as pure, unit-tested utilities).
 *
 * Selection state is lifted (props) so the C4 preview panel can close a
 * previewed row's preview on bulk delete and keep preview consistent.
 *
 * Library variants (LIBRARY_PLAN.md §5, variant='library'|'trash'):
 *  - the page owns the toolbar (hideToolbar) — SaaS `library-toolbar`
 *  - cardLayout 'full': title line + author/year meta + `Updated __date__`
 *  - rowIdOf: stable row identity for duplicate-key rows (SaaS allows
 *    duplicate keys; the row's _id — parsed as `libId` — is the key)
 *  - bulk actions: library = Download + Delete; trash = Restore +
 *    "Delete permanently"
 *  - duplicateIds rows show a `bibtex_duplicates_keys` warning badge
 * In-project behavior (variant 'project', all defaults) is unchanged.
 */
import React, { useCallback, useMemo, useRef, useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { plural } from '../utils/plural'
import {
  OLDropdown,
  OLDropdownItem,
  OLDropdownMenu,
  OLDropdownToggle,
} from '@/shared/components/ol/ol-dropdown-menu'
import type { BibEntry } from '../utils/bib-types'
import { getEntryType, getMissingRequiredFields } from '../utils/bib-types'
import { matchesSearch, splitHighlighted } from '../utils/preview-model'
import type { BibEntryDiagnosticsMap } from '../utils/bib-source-diagnostics'
import { diagnosticLabel } from '../utils/bib-source-diagnostics'

/** Default stable row identity = citation key (in-project usage). */
function defaultRowIdOf(entry: BibEntry): string {
  return entry.id
}

type Props = {
  entries: BibEntry[]
  onSelect: (entry: BibEntry) => void
  /** Preview binding (C4): the entry id whose preview is open */
  previewId?: string | null
  /** Bulk selection (C3): checked row ids (bulk-bar driven) */
  selectedIds?: string[]
  onToggleSelect?: (id: string) => void
  onToggleSelectAll?: (kind: 'all' | 'none') => void
  /** Bulk delete (C4/W5): the panel wires this to the guarded W5 write */
  onBulkDelete?: () => void
  /** Open document filename (dynamic "Search <file>" placeholder) */
  openDocName?: string
  /** C5: add actions (Paste references / Enter manually / Library stub) */
  onAddPaste: () => void
  onAddManual: () => void
  /** Library variants (LIBRARY_PLAN.md §5) — all optional, in-project
   *  defaults keep the Phase C behavior exactly. */
  variant?: 'project' | 'library' | 'trash'
  /** library/trash: the page renders its own SaaS toolbar row */
  hideToolbar?: boolean
  /** SaaS library rows: title line + author/year meta (default 'compact') */
  cardLayout?: 'compact' | 'full'
  /** 'Updated __date__' line (SaaS `bibtex-entry-card-updated-at`) */
  showUpdatedAt?: boolean
  /** Stable row identity (duplicate keys) — default `entry.id` */
  rowIdOf?: (entry: BibEntry) => string
  /** Rows whose citation key is used by more than one row (SaaS warning) */
  duplicateIds?: Set<string>
  /** Rows carrying source diagnostics, keyed by entry object identity */
  diagnostics?: BibEntryDiagnosticsMap
  /** library view: bulk Download (selection) */
  onBulkDownload?: () => void
  /** trash view: bulk Restore */
  onBulkRestore?: () => void
  /** label for the bulk Delete button (trash: "Delete permanently") */
  bulkDeleteLabel?: string
  /** C9 (project side): functional Add-menu "Import from Library" */
  onAddFromLibrary?: () => void
  /** ORCID import (P2) — shown in the Add menu when the host wires it. */
  onAddFromOrcid?: () => void
  /** Zotero import (P4) — shown in the Add menu when the host wires it. */
  onAddFromZotero?: () => void
  /** Mendeley import — shown in the Add menu when the host wires it. */
  onAddFromMendeley?: () => void
  /** Upload .bib file (owner #11, 2026-09-13 editor wave) — parity with
   *  the /hub library Add menu; shown when the host wires it. */
  onAddUpload?: () => void
}

export default function BibEntryList({
  entries,
  onSelect,
  previewId = null,
  selectedIds = [],
  onToggleSelect,
  onToggleSelectAll,
  onBulkDelete,
  openDocName,
  onAddPaste,
  onAddManual,
  variant = 'project',
  hideToolbar = false,
  cardLayout = 'compact',
  showUpdatedAt = false,
  rowIdOf = defaultRowIdOf,
  duplicateIds,
  diagnostics,
  onBulkDownload,
  onBulkRestore,
  bulkDeleteLabel,
  onAddFromLibrary,
  onAddFromOrcid,
  onAddFromZotero,
  onAddFromMendeley,
  onAddUpload,
}: Props) {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  const filtered = useMemo(() => {
    return entries.filter(e => matchesSearch(e, search))
  }, [entries, search])

  // Focus the search box when the list mounts (reviewer: on opening a bib
  // file in list mode, focus goes to the search box).
  useEffect(() => {
    if (entries.length > 0) {
      const raf = requestAnimationFrame(() => searchRef.current?.focus())
      return () => cancelAnimationFrame(raf)
    }
  }, [entries.length])

  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSearch('')
      }
    },
    []
  )

  return (
    <div className="bibtex-entry-list">
      {!hideToolbar && (
      <div className="bibtex-entry-list-panel">
        {/* SaaS list search: form-control (sm) with a leading icon. */}
        <div className="bibtex-search">
          <div className="form-control-wrapper form-control-wrapper-sm">
            <span className="form-control-start-icon">
              <span className="material-symbols" aria-hidden="true">
                search
              </span>
            </span>
            <input
              id="bib-list-search"
              ref={searchRef}
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder={t('Search __fileName__', {
                fileName: openDocName || '.bib',
              })}
              aria-label={t('search')}
              className="form-control-offset-start form-control form-control-sm"
            />
          </div>
        </div>
        {/* SaaS Add dropdown (capture 2b): btn-secondary custom-toggle;
            items: Paste references [BibTeX, DOI] / Enter manually.
            "Import from Library" (C9) is the CE extra, gated by host wiring. */}
        <OLDropdown className="bibtex-add-button" align="end">
          <OLDropdownToggle
            className="d-inline-grid custom-toggle dropdown-toggle btn btn-secondary btn-sm"
            aria-label={t('Add')}
            aria-expanded={false}
          >
            <span className="button-content">
              <span className="material-symbols" aria-hidden="true">
                add
              </span>
              {t('Add')}
            </span>
          </OLDropdownToggle>
          <OLDropdownMenu>
              <OLDropdownItem description={t('BibTeX, DOI')} onClick={onAddPaste}>
                {t('Paste references')}
              </OLDropdownItem>
              {/* Owner #11 (2026-09-13 editor wave): the /hub library Add
                  menu offers "Upload .bib file" and the editor's did not —
                  the two menus should match (the editor keeps its extra
                  "Import from Library"). */}
              {onAddUpload ? (
                <OLDropdownItem description={t('.bib file')} onClick={onAddUpload}>
                  {t('Upload .bib file')}
                </OLDropdownItem>
              ) : null}
              <OLDropdownItem onClick={onAddManual}>
                {t('Enter manually')}
              </OLDropdownItem>
              {/* P2 — "Import from ORCID.org" (BIB_ORCID_TEMPLATES_PLAN.md):
                  wired by both hosts (project panel + library top bar). */}
              {onAddFromOrcid ? (
                <OLDropdownItem
                  description={t('Search ORCID by name or iD')}
                  onClick={onAddFromOrcid}
                >
                  {t('Import from ORCID.org')}
                </OLDropdownItem>
              ) : null}
              {/* P4 — "Import from Zotero" (BIB_ORCID_TEMPLATES_PLAN.md): same
                  UX as the ORCID picker, source = the user's linked Zotero. */}
              {onAddFromZotero ? (
                <OLDropdownItem
                  description={t('Browse your Zotero libraries and import items')}
                  onClick={onAddFromZotero}
                >
                  {t('Import from Zotero')}
                </OLDropdownItem>
              ) : null}
              {/* Mendeley import: same UX as the ORCID/Zotero pickers,
                  source = the user's linked Mendeley. */}
              {onAddFromMendeley ? (
                <OLDropdownItem
                  description={t('Browse your Mendeley library and import items')}
                  onClick={onAddFromMendeley}
                >
                  {t('Import from Mendeley')}
                </OLDropdownItem>
              ) : null}
              {/* C9 — "Import from Library" (LIBRARY_PLAN.md): enabled when
                  the host wires it (project panel); the disabled stub is
                  the pre-L behavior fallback. */}
              {onAddFromLibrary ? (
                <OLDropdownItem onClick={onAddFromLibrary}>
                  {t('Import from Library')}
                </OLDropdownItem>
              ) : (
                <OLDropdownItem disabled>
                  <span title={t('Library import is not available in this build yet.')}>{t('Import from Library')}</span>
                </OLDropdownItem>
              )}
          </OLDropdownMenu>
        </OLDropdown>
      </div>
      )}

      {/* Bulk bar (C3 capture): select-all ("Select all entries") +
          "N reference(s)" = the count of entries in view. Delete (C4
          wire-up over W5 core) appears when any row is checked.
          library variants (SaaS): Download + Delete; trash: Restore +
          "Delete permanently". */}
      <div className="bibtex-bulk-actions-bar">
        <label className="bibtex-bulk-actions-select-all">
          <input
            type="checkbox"
            aria-label={t('Select all entries')}
            checked={
              filtered.length > 0 &&
              selectedIds.length > 0 &&
              selectedIds.every(id =>
                filtered.some(e => rowIdOf(e) === id)
              )
            }
            onChange={e => onToggleSelectAll?.(e.target.checked ? 'all' : 'none')}
          />
          <span>{t('Select all')}</span>
        </label>
        {selectedIds.length > 0 && variant === 'trash' && onBulkRestore ? (
          <button
            type="button"
            className="bibtex-bulk-actions-restore-btn library-bulk-actions-restore-btn btn btn-secondary btn-sm"
            onClick={(e) => {
              e.stopPropagation()
              onBulkRestore?.()
            }}
          >
            {t('Restore')}
          </button>
        ) : null}
        {selectedIds.length > 0 && onBulkDownload ? (
          <button
            type="button"
            className="bibtex-bulk-actions-download-btn library-bulk-actions-download-btn btn btn-secondary btn-sm"
            onClick={(e) => {
              e.stopPropagation()
              onBulkDownload?.()
            }}
          >
            {variant === 'library' ? t('Download') : t('Download selected')}
          </button>
        ) : null}
        {selectedIds.length > 0 && onBulkDelete ? (
          <button
            type="button"
            className={`bibtex-bulk-actions-delete library-bulk-actions-delete-btn btn ${variant === 'trash' ? 'btn-danger' : 'btn-secondary'} btn-sm`}
            onClick={(e) => {
              e.stopPropagation()
              onBulkDelete?.()
            }}
          >
            {bulkDeleteLabel ?? t('delete')}
          </button>
        ) : null}
        <span className="bibtex-bulk-actions-count">
          {plural(t, filtered.length, 'one_reference', 'many_references')}
        </span>
      </div>

      <div className="bibtex-list-count" aria-hidden="true">
        {filtered.length === entries.length
          ? plural(t, entries.length, 'one_reference', 'many_references')
          : `${filtered.length} / ${entries.length}`}
      </div>

      {(variant === 'project') && ((filtered.length === 0 || entries.length === 0) && (
        <div className="bib-list-empty">
          {entries.length === 0
            ? t('No bibliography entries yet. Click "Add new entry" to create one.')
            : t('No entries match your search.')}
        </div>
      ))}

      {/* List body (capture: role=list, card rows with data-index). Rows
          render in normal flow so content-height cards never overlap and
          the body flexes to fill the list column. */}
      <div className="bibtex-entry-list-body" role="list">
        {filtered.map((entry, i) => (
          <div
            key={`${rowIdOf(entry)}-${(entry as { sourceStart?: number }).sourceStart ?? ''}`}
            data-index={i}
            data-entry-id={rowIdOf(entry)}
            className="bibtex-entry-card-row"
            role="listitem"
          >
            <BibEntryCard
              entry={entry}
              index={i}
              onSelect={onSelect}
              previewing={previewId === rowIdOf(entry)}
              checked={selectedIds.includes(rowIdOf(entry))}
              onToggleSelect={onToggleSelect}
              search={search}
              rowId={rowIdOf(entry)}
              fullLayout={cardLayout === 'full'}
              showUpdatedAt={showUpdatedAt}
              duplicate={duplicateIds?.has(rowIdOf(entry)) ?? false}
              sourceIssue={
                diagnostics?.get(entry)?.[0]
                  ? diagnosticLabel(diagnostics.get(entry)![0], t)
                  : undefined
              }
            />
          </div>
        ))}
      </div>
    </div>
  )
}

function BibEntryCard({
  entry,
  index,
  onSelect,
  previewing,
  checked,
  onToggleSelect,
  search,
  rowId,
  fullLayout,
  showUpdatedAt,
  duplicate,
  sourceIssue,
}: {
  entry: BibEntry
  index: number
  onSelect: (entry: BibEntry) => void
  previewing: boolean
  checked: boolean
  onToggleSelect?: (id: string) => void
  /** D15: the raw search text (per-row `<mark>` highlight) */
  search: string
  /** Stable row identity (duplicate-key safe) */
  rowId: string
  /** SaaS library row layout (title line + meta line + Updated date) */
  fullLayout?: boolean
  showUpdatedAt?: boolean
  /** SaaS `bibtex_duplicates_keys` warning (duplicate citation key) */
  duplicate?: boolean
  /** Human-readable first source diagnostic for this entry (board #5) */
  sourceIssue?: string
}) {
  const t = useTranslation().t
  const typeDef = getEntryType(entry.type)
  const missingFields = typeDef
    ? getMissingRequiredFields(typeDef.requiredFields, entry.fields)
    : []
  const hasErrors =
    missingFields.length > 0 || entry.id.trim().length === 0
  const title = entry.fields.title || t('Untitled')
  const author = entry.fields.author || ''
  const year = entry.fields.year || entry.fields.date || ''

  // SaaS `Updated __date__` (full layout only)
  const updatedDate = useMemo(() => {
    if (!showUpdatedAt || !entry.updatedAt) return null
    try {
      const d = new Date(entry.updatedAt)
      if (Number.isNaN(d.getTime())) return null
      return d.toLocaleDateString()
    } catch {
      return null
    }
  }, [showUpdatedAt, entry.updatedAt])

  // Truncate long author lists
  const authorDisplay = useMemo(() => {
    const parts = author.split(/\s+and\s+/i)
    if (parts.length <= 2) return author
    const first = parts[0] || ''
    return `${first} et al.`
  }, [author])

  const handleCardKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        onSelect(entry)
      }
    },
    [entry, onSelect]
  )

  const toggleId = rowId || entry.id

  return (
    <div
      id={`bibtex-entry-card-${toggleId}#${index}`}
      className={[
        'bibtex-entry-card',
        fullLayout ? 'bibtex-entry-card-full' : 'bibtex-entry-card-compact',
        'bibtex-entry-card-clickable',
        hasErrors ? 'bibtex-entry-card-errors' : '',
        previewing ? 'bibtex-entry-card-previewing' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      role="button"
      tabIndex={-1}
      onClick={() => onSelect(entry)}
      onKeyDown={handleCardKeyDown}
    >
      <div className="bibtex-entry-card-checkbox">
        <input
          type="checkbox"
          aria-label={t('Select entry')}
          checked={checked}
          onClick={e => e.stopPropagation()}
          onChange={() => onToggleSelect?.(toggleId)}
        />
      </div>
      <div className="bibtex-entry-card-content">
        {/* R7 (2026-08-29): reviewer-matched arrangement — the citation
            key on its own row first, then title, then author, then year
            (both card layouts; 'Updated' line stays full-layout only). */}
        <div className="bibtex-entry-card-key-row">
          <span className="bibtex-entry-card-key">
            <Highlighted text={entry.id} search={search} />
          </span>
          {duplicate && (
            <span
              className="bibtex-entry-duplicate-icon"
              role="img"
              aria-label={t('bibtex_duplicates_keys')}
              title={t('bibtex_duplicates_keys')}
            >
              <span className="material-symbols" aria-hidden="true">
                warning
              </span>
            </span>
          )}
          {hasErrors && (
            <span className="bibtex-entry-error-icon" role="img" aria-label={t('Entry has errors')}>
              <span className="material-symbols" aria-hidden="true">
                error
              </span>
            </span>
          )}
          {sourceIssue && (
            <span
              className="bibtex-entry-syntax-icon"
              role="img"
              aria-label={sourceIssue}
              title={sourceIssue}
            >
              <span className="material-symbols" aria-hidden="true">
                rule
              </span>
            </span>
          )}
        </div>
        {title && (
          <div className="bibtex-entry-card-title">
            <span>
              <Highlighted text={title} search={search} />
            </span>
          </div>
        )}
        {authorDisplay && (
          <div className="bibtex-entry-card-author">
            <span>
              <Highlighted text={authorDisplay} search={search} />
            </span>
          </div>
        )}
        {year && (
          <div className="bibtex-entry-card-year">
            <span>
              <Highlighted text={year} search={search} />
            </span>
          </div>
        )}
        {fullLayout && updatedDate && (
          <div className="bibtex-entry-card-updated-at">
            {t('Updated __date__', { date: updatedDate })}
          </div>
        )}
      </div>
    </div>
  )
}


/**
 * D15 (search scope) — wrap case-insensitive matches in `<mark>` (the
 * reference `.bibtex-entry-card-key mark{padding:0}`). Non-query text is a
 * plain span (no highlight DOM); no match is also plain text.
 */
function Highlighted({ text, search }: { text: string; search: string }) {
  const segments = splitHighlighted(text, search)
  if (segments.length <= 1) {
    return <>{text}</>
  }
  return (
    <>
      {segments.map((s, i) =>
        s.match ? (
          <mark key={i}>{s.text}</mark>
        ) : (
          <React.Fragment key={i}>{s.text}</React.Fragment>
        )
      )}
    </>
  )
}
