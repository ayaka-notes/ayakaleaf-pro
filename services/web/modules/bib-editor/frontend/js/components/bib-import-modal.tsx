/**
 * Paste-references import modal (Phase C C5, PHASE_C_PLAN.md §1.6/§3-C5).
 *
 * Two steps (capture):
 *  1. "Add reference" modal with `bibtex-import-form`:
 *     label "Reference" + `bibtex-import-textarea` (rows≈6), helper
 *     "Paste BibTeX or DOIs here.", footer Cancel + **Preview** (disabled
 *     until the textarea is non-empty).
 *  2. "Preview" modal (back arrow → return to the textarea):
 *     `bibtex-import-preview-header` (Select all + count) and a
 *     `bibtex-import-preview-list` of `bibtex-import-preview-card` rows:
 *       - checkbox (label = citation key; OQ-9: conflict rows pre-unchecked)
 *       - `bibtex-import-preview-card-key` (citation key)
 *       - `bibtex-import-preview-card-details`: humanized heading
 *         ("Ernst et al. (2007)") + title line
 *       - `bibtex-import-preview-card-tags` (type badge)
 *     footer count + Cancel / **Import**.
 *
 * Input is a mix of BibTeX text and `doi:` / bare-DOI lines (split locally,
 * paste order preserved — bib-import.ts). DOI lines resolve through the
 * committed client-side `fetchEntryFromDoi` (OQ-8); a failed resolution is
 * an ERROR row (the good rows still import). Conflict rows (key already in
 * the file or duplicated in the import — OQ-9) are pre-unchecked and the
 * planner re-rejects any import that contains one anyway.
 *
 * Import = ONE guarded, all-or-nothing write (`importMany` →
 * planBibImport in the extension; rejected on stale source / conflict).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { plural } from '../utils/plural'
import OLButton from '@/shared/components/ol/ol-button'
import OLFormLabel from '@/shared/components/ol/ol-form-label'
import {
  OLModal,
  OLModalBody,
  OLModalFooter,
  OLModalHeader,
  OLModalTitle,
} from '@/shared/components/ol/ol-modal'
import { fetchEntryFromDoi } from '../utils/doi-fetcher'
import { generateCitationKey } from '../utils/bib-parser'
import type { BibEntry } from '../utils/bib-types'
import {
  splitImportText,
  buildImportRows,
  type BibImportRow,
} from '../utils/bib-import.ts'

type Props = {
  show: boolean
  existingIds: string[]
  /** The open document's source (context; the extension guards against
   *  `expectedSource`). */
  source?: string
  /** The source snapshot the extension guards the import against */
  expectedSource: string
  /** Fired for the Import button (the panel dispatches the guarded event) */
  onImport: (entries: BibEntry[]) => void
  onHidden: () => void
  /** Library (SaaS): pre-fill the paste step (Upload .bib file → same
   *  pipeline). Default empty string. */
  initialText?: string
}

export default function BibImportModal({
  show,
  existingIds,
  source,
  expectedSource,
  onImport,
  onHidden,
  initialText = '',
}: Props) {
  const { t } = useTranslation()

  const [mode, setMode] = useState<'paste' | 'preview'>('paste')
  const [text, setText] = useState('')
  const [rows, setRows] = useState<BibImportRow[]>([])
  const [checkedRowIds, setCheckedRowIds] = useState<string[]>([])
  const [previewDone, setPreviewDone] = useState(false)
  void expectedSource
  void source

  // Reset to a fresh "Add reference" → paste step whenever the modal opens.
  // `show` is the only remount signal (the component stays mounted to
  // follow the OLModal show/hide contract).
  useEffect(() => {
    if (show) {
      setMode('paste')
      setText(initialText)
      setRows([])
      setCheckedRowIds([])
      setPreviewDone(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show])

  const handlePreview = useCallback(async () => {
    if (!text.trim()) return
    setMode('preview')
    setPreviewDone(false)
    setCheckedRowIds([])
    setRows([])

    const items = splitImportText(text)
    // Parallel to the 'doi' items of `items` (paste order); `undefined` =
    // still resolving (the row is transient until its own resolve lands).
    const doiResults: (string | BibEntry | undefined)[] = items
      .filter(it => it.kind === 'doi')
      .map(() => undefined)
    setRows(buildImportRows(items, doiResults, existingIds))

    let doiIndex = 0
    for (const it of items) {
      if (it.kind !== 'doi') continue
      const raw = it.raw
      let result: string | BibEntry
      try {
        const fetched = await fetchEntryFromDoi(raw)
        result = {
          type: fetched.type,
          id: fetched.id || generateCitationKey(fetched.fields),
          fields: { ...fetched.fields },
        }
      } catch (err) {
        result = err instanceof Error ? err.message : t('Failed to fetch DOI')
      }
      doiResults[doiIndex] = result
      doiIndex++
      // Rebuild after each resolution so the row settles live.
      setRows(buildImportRows(items, doiResults, existingIds))
    }
    const finalRows = buildImportRows(items, doiResults, existingIds)
    setRows(finalRows)
    setPreviewDone(true)
    // OQ-9: pre-check every importable (non-conflict) row.
    setCheckedRowIds(
      finalRows
        .filter(r => r.status === 'ok' || r.status === 'doi-ok')
        .map(r => r.rowId)
    )
  }, [text, existingIds, t])

  const importable = useMemo(
    () => rows.filter(r => r.status === 'ok' || r.status === 'doi-ok'),
    [rows]
  )
  const checkedCount = checkedRowIds.length

  const toggleRow = useCallback((rowId: string) => {
    setCheckedRowIds(prev =>
      prev.includes(rowId) ? prev.filter(id => id !== rowId) : [...prev, rowId]
    )
  }, [])

  const handleToggleSelectAll = useCallback((checked: boolean) => {
    setCheckedRowIds(checked ? importable.map(r => r.rowId) : [])
  }, [importable])

  const handleImport = useCallback(() => {
    onImport(
      importable
        .filter(r => checkedRowIds.includes(r.rowId))
        .map(r => r.entry as BibEntry)
    )
  }, [importable, checkedRowIds, onImport])

  // Reference D10 affordances:
  //  - empty state (`bibtex-import-preview-empty`) when the paste yields
  //    nothing importable (previewDone + zero importable rows)
  //  - footer-warning when nothing is checked (Import shows why it's idle)
  const previewEmpty = previewDone && importable.length === 0

  return (
    <OLModal show={show} onHide={onHidden} data-testid="bib-import-modal">
      <OLModalHeader>
        {mode === 'preview' ? (
          <>
            {/* SaaS: labeled Back + visually-hidden "Preview" title */}
            <OLButton
              variant="ghost"
              leadingIcon="arrow_back"
              aria-label={t('back')}
              onClick={() => setMode('paste')}
            >
              {t('back')}
            </OLButton>
            <OLModalTitle className="visually-hidden">{t('Preview')}</OLModalTitle>
          </>
        ) : (
          <OLModalTitle>{t('Add reference')}</OLModalTitle>
        )}
      </OLModalHeader>

      {mode === 'paste' ? (
        <>
          <OLModalBody className="bibtex-import-form">
            <div className="form-group">
              <OLFormLabel htmlFor="bib-import-textarea">
                {t('Reference')}
              </OLFormLabel>
              <textarea
                id="bib-import-textarea"
                className="bibtex-import-textarea form-control"
                rows={6}
                value={text}
                onChange={e => setText(e.target.value)}
                aria-describedby="bib-import-help"
              />
              <div className="form-text" id="bib-import-help">
                {t('Paste BibTeX or DOIs here.')}
              </div>
            </div>
          </OLModalBody>
          <OLModalFooter>
            <OLButton variant="secondary" onClick={onHidden}>
              {t('cancel')}
            </OLButton>
            <OLButton
              variant="primary"
              disabled={text.trim() === ''}
              onClick={() => void handlePreview()}
              type="button"
            >
              {t('Preview')}
            </OLButton>
          </OLModalFooter>
        </>
      ) : (
        <>
          <OLModalBody>
            {previewEmpty ? (
              <div className="bibtex-import-preview-empty">
                {t('No references')}
              </div>
            ) : (
              <>
                <div className="bibtex-import-preview-header">
                  <label
                    className="wide-target-checkbox bibtex-import-preview-check-all"
                  >
                    <span className="visually-hidden">{t('Select all')}</span>
                    <span className="wide-target-checkbox-box">
                      <span className="form-checkbox">
                        <input
                          type="checkbox"
                          className="form-check-input"
                          aria-label={t('Select all')}
                          checked={
                            importable.length > 0 &&
                            importable.every(r => checkedRowIds.includes(r.rowId))
                          }
                          disabled={importable.length === 0 || !previewDone}
                          onChange={e => handleToggleSelectAll(e.target.checked)}
                        />
                      </span>
                    </span>
                  </label>
                  <div className="bibtex-import-preview-count">
                    {plural(t, importable.length, 'one_reference', 'many_references')}
                  </div>
                </div>
                <div className="bibtex-import-preview-list">
                  {rows.map(row => (
                    <BibImportCard
                      key={row.rowId}
                      row={row}
                      checked={checkedRowIds.includes(row.rowId)}
                      onToggle={toggleRow}
                      t={t}
                    />
                  ))}
                </div>
              </>
            )}
          </OLModalBody>
          <OLModalFooter>
            <div className="bibtex-import-preview-footer">
              {checkedCount === 0 && !previewEmpty && (
                <div className="bibtex-import-preview-footer-warning" role="alert">
                  <span aria-hidden="true" className="material-symbols">error</span>
                  <span>{t('Select at least 1 reference')}</span>
                </div>
              )}
              <div className="bibtex-import-preview-footer-actions">
                {!previewEmpty && (
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
                    disabled={previewEmpty || !previewDone || checkedCount === 0}
                    onClick={handleImport}
                  >
                    {t('Save')}
                  </OLButton>
                </div>
              </div>
            </div>
          </OLModalFooter>
        </>
      )}
    </OLModal>
  )
}

function BibImportCard({
  row,
  checked,
  onToggle,
  t,
}: {
  row: BibImportRow
  checked: boolean
  onToggle: (rowId: string) => void
  t: (key: string) => string
}) {
  const selectable =
    row.status === 'ok' || row.status === 'doi-ok' || row.status === 'conflict'
  // D10: a library conflict (key already in the document) shows the
  // "Already in your library" tag (reference capture); a duplicate
  // (same key pasted twice in one batch) keeps the error line.
  const alreadyInLibrary =
    row.status === 'conflict' && row.kind === 'library'

  return (
    <div className="bibtex-import-preview-card">
      {selectable && (
        <div className="wide-target-checkbox bibtex-import-preview-card-check">
          <span className="wide-target-checkbox-box">
            <span className="form-checkbox">
              <input
                type="checkbox"
                className="form-check-input"
                aria-label={row.entry ? row.entry.id : t('Untitled')}
                checked={checked}
                disabled={row.status === 'empty'}
                onChange={() => onToggle(row.rowId)}
              />
            </span>
          </span>
        </div>
      )}
      <div className="bibtex-import-preview-card-content">
        <div className="bibtex-import-preview-card-key">
          {row.status === 'empty'
            ? t('Resolving…')
            : row.status === 'error'
              ? t('Could not import this reference')
              : (row.entry ? row.entry.id : t('Untitled'))}
        </div>
        <div className="bibtex-import-preview-card-details">
          {row.heading && (
            <div className="bibtex-import-preview-card-heading">
              {row.heading}
            </div>
          )}
          {row.title && (
            <div className="bibtex-import-preview-card-field">
              {row.title}
            </div>
          )}
          {row.status === 'error' && (
            <div className="bibtex-import-preview-card-error">
              {row.error || row.raw}
            </div>
          )}
          {row.status === 'conflict' && !alreadyInLibrary && (
            <div className="bibtex-import-preview-card-conflict">
              {t('Key already exists in the file')}
            </div>
          )}
          {row.status === 'empty' && (
            <div className="bibtex-import-preview-card-resolving">
              {row.raw}
            </div>
          )}
        </div>
        {alreadyInLibrary && (
          <div className="bibtex-import-preview-card-tags">
            <span className="bibtex-already-in-library">
              {t('Already in your library')}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
