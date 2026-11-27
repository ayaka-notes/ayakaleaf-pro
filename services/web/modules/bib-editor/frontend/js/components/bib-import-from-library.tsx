/**
 * "Import from Library" (C9, LIBRARY_PLAN.md §5) — the single deliberate
 * deviation from the reference capture: the in-project Add menu item that
 * imports the user's Library entries into the open `.bib` file.
 *
 * Flow (SaaS-consistent):
 *  1. list the Library (`GET /library/references`) — client search filter
 *     (the server also supports search; we filter the loaded page for
 *     instant feel and note the loaded count)
 *  2. checkbox rows (key + humanized heading + type), conflict rows
 *     (citation key already in the OPEN FILE — OQ-9) are PRE-UNCHECKED
 *     and marked, mirroring the Paste-references import preview
 *  3. Import dispatches through the SAME guarded, all-or-nothing project
 *     import path (`importMany` → W5 core) as Paste references — the
 *     extension re-resolves against the live document and rejects stale /
 *     conflicting writes with a banner. No new write machinery.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { plural } from '../utils/plural'
import OLButton from '@/shared/components/ol/ol-button'
import {
  OLModal,
  OLModalBody,
  OLModalFooter,
  OLModalHeader,
  OLModalTitle,
} from '@/shared/components/ol/ol-modal'
import { humanizeCitationHeading } from '../utils/overleaf-type-map.ts'
import type { BibEntry } from '../utils/bib-types'

/**
 * Publication venue for preview cards (item: show the publication title,
 * not the type): first non-empty of the venue fields; falls back to the
 * entry type so the chip never renders empty.
 */
function publicationName(entry: BibEntry): string {
  const f = entry.fields ?? {}
  for (const name of [f.journaltitle, f.journal, f.booktitle, f.eventtitle, f.venue, f.school, f.institution]) {
    if (name && name.trim()) return name.trim()
  }
  // No venue: the type chip already shows the type — avoid a redundant
  // "article" chip next to it.
  return ''
}

function publicationTitle(entry: BibEntry): string {
  const title = entry.fields?.title
  return title && title.trim() ? title.trim() : ''
}
import * as api from '../library/library-api'
import {
  entryMatchesQuery,
  toRows,
  type LibraryRow,
} from '../library/library-model'

type Props = {
  show: boolean
  /** Citation keys already in the OPEN FILE (conflict hint, OQ-9) */
  existingIds: string[]
  /** Fired with the SELECTED entries (the host dispatches importMany) */
  onImport: (entries: BibEntry[]) => void
  onHidden: () => void
}

export default function BibImportFromLibrary({
  show,
  existingIds,
  onImport,
  onHidden,
}: Props) {
  const { t } = useTranslation()

  const [rows, setRows] = useState<LibraryRow[]>([])
  const [loading, setLoading] = useState(false)
  const [listError, setListError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [checkedRowIds, setCheckedRowIds] = useState<string[]>([])
  const [done, setDone] = useState(false)

  // Load the library once per open (client search then filters rows).
  useEffect(() => {
    if (!show) return
    let cancelled = false
    setRows([])
    setListError(null)
    setCheckedRowIds([])
    setQuery('')
    setDone(false)
    setLoading(true)
    api
      .listEntries({ limit: 200 })
      .then(res => {
        if (cancelled) return
        const all = toRows(res.items)
        setRows(all)
        // Pre-check every non-conflict row (OQ-9: conflicts pre-unchecked).
        setCheckedRowIds(
          all
            .filter(r => !existingIds.includes(r.entry.id))
            .map(r => r.rowId)
        )
      })
      .catch(err => {
        if (cancelled) return
        setListError(
          err instanceof Error ? err.message : t('error_loading_references')
        )
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [show, existingIds, t])

  const takenSet = useMemo(() => new Set(existingIds), [existingIds])

  const visibleRows = useMemo(
    () => rows.filter(r => entryMatchesQuery(r.entry, query)),
    [rows, query]
  )
  const importableRows = useMemo(
    () => visibleRows.filter(r => !takenSet.has(r.entry.id)),
    [visibleRows, takenSet]
  )
  const checkedCount = checkedRowIds.length
  const allImportableChecked =
    importableRows.length > 0 &&
    importableRows.every(r => checkedRowIds.includes(r.rowId))

  const toggleRow = useCallback((rowId: string) => {
    setCheckedRowIds(prev =>
      prev.includes(rowId) ? prev.filter(id => id !== rowId) : [...prev, rowId]
    )
  }, [])

  const toggleAll = useCallback(
    (checked: boolean) => {
      setCheckedRowIds(
        checked ? importableRows.map(r => r.rowId) : []
      )
    },
    [importableRows]
  )

  const handleImport = useCallback(() => {
    const selected = new Set(checkedRowIds)
    const entries: BibEntry[] = visibleRows
      .filter(r => selected.has(r.rowId) && !takenSet.has(r.entry.id))
      .map(r => ({
        type: r.entry.type,
        id: r.entry.id,
        fields: { ...r.entry.fields },
      }))
    if (entries.length > 0) {
      onImport(entries)
    }
    setDone(true)
  }, [checkedRowIds, visibleRows, takenSet, onImport])

  return (
    <OLModal
      show={show}
      onHide={onHidden}
      data-testid="bib-import-from-library"
    >
      <OLModalHeader>
        <OLModalTitle>{t('Import from Library')}</OLModalTitle>
      </OLModalHeader>
      <OLModalBody>
        {listError ? (
          <div className="bib-list-empty" role="alert">
            {listError}
          </div>
        ) : loading ? (
          <div className="bib-list-empty">
            {t('Loading your Library…')}
          </div>
        ) : rows.length === 0 ? (
          <div className="bib-list-empty">
            {t('Your Library is empty. Add references from the Library page first.')}
          </div>
        ) : (
          <>
            <div className="bibtex-import-preview-header">
              <label className="bibtex-import-preview-check-all">
                <input
                  type="checkbox"
                  aria-label={t('Select all')}
                  checked={allImportableChecked}
                  disabled={importableRows.length === 0}
                  onChange={e => toggleAll(e.target.checked)}
                />
              </label>
              <div className="bibtex-import-preview-count">
                {plural(t, importableRows.length, 'one_reference', 'many_references')}
              </div>
            </div>
            <div className="bibtex-search form-control-wrapper">
              <input
                type="search"
                className="bibtex-search-input form-control"
                aria-label={t('Search in your library')}
                placeholder={t('Search in your library')}
                value={query}
                onChange={e => setQuery(e.target.value)}
              />
            </div>
            {visibleRows.length === 0 ? (
              <div className="bib-list-empty">
                {t('No references found in your Library.')}
              </div>
            ) : (
              <div className="bibtex-import-preview-list">
                {visibleRows.map(row => {
                  const conflict = takenSet.has(row.entry.id)
                  const checked = checkedRowIds.includes(row.rowId)
                  return (
                    <div
                      key={row.rowId}
                      className="bibtex-import-preview-card"
                      data-conflict={conflict ? 'true' : undefined}
                    >
                      {/* overleaf-lab (2026-09-04, owner #2 re-do): the checkbox and
                          the citation key share ONE flex row — aligned by
                          construction for every card, no matter how many detail
                          lines follow below. The old layout nested the key deep
                          in the content column, so a top-level checkbox could
                          never line up with it. */}
                      <div className="bibtex-import-preview-card-top">
                        <div className="bibtex-import-preview-card-check">
                          <input
                            type="checkbox"
                            aria-label={row.entry.id || t('Untitled')}
                            checked={checked}
                            disabled={conflict}
                            onChange={() => toggleRow(row.rowId)}
                          />
                        </div>
                        <div className="bibtex-import-preview-card-key">
                          {row.entry.id || t('Untitled')}
                        </div>
                      </div>
                      <div className="bibtex-import-preview-card-details">
                        <div className="bibtex-import-preview-card-heading">
                          {humanizeCitationHeading(row.entry.id, row.entry.fields)}
                        </div>
                        {publicationTitle(row.entry) && (
                          <div className="bibtex-import-preview-card-title">
                            {publicationTitle(row.entry)}
                          </div>
                        )}
                        {conflict && (
                          <div className="bibtex-import-preview-card-conflict">
                            {t('Key already exists in the file')}
                          </div>
                        )}
                      </div>
                      <div className="bibtex-import-preview-card-tags">
                        {publicationName(row.entry) && (
                          <span className="bib-publication-name">
                            {publicationName(row.entry)}
                          </span>
                        )}
                        <span className="bib-type-tag">{row.entry.type}</span>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </>
        )}
      </OLModalBody>
      <OLModalFooter>
        <div className="bibtex-import-preview-footer">
          {checkedCount === 0 && !listError && (
            <div
              className="bibtex-import-preview-footer-warning"
              role="alert"
            >
              <span aria-hidden="true" className="material-symbols">
                error
              </span>
              <span>{t('Select at least 1 reference')}</span>
            </div>
          )}
          <div className="bibtex-import-preview-footer-actions">
            {checkedCount > 0 && (
              <div className="bibtex-import-preview-footer-count">
                {plural(t, checkedCount, 'one_reference', 'many_references')}
              </div>
            )}
            <div className="bibtex-import-preview-footer-buttons">
              <OLButton variant="secondary" onClick={onHidden}>
                {t('cancel')}
              </OLButton>
              <OLButton
                variant="primary"
                disabled={
                  loading || listError !== null || checkedCount === 0 || done
                }
                onClick={handleImport}
              >
                {t('Import')}
              </OLButton>
            </div>
          </div>
        </div>
      </OLModalFooter>
    </OLModal>
  )
}
