/**
 * /library page — SaaS Library anatomy (LIBRARY_PLAN.md §5, §1.4 anatomy).
 *
 * ```
 * library-page-main
 *  └─ library-toolbar
 *      ├─ library-heading-row [ h1 "Library"/"Trash" + tabs ]
 *      ├─ library-toolbar-actions [ bibtex-search ]
 *      └─ library-toolbar-buttons [ Add ▾ (library view) ]
 *  └─ (library-trash-notification — trash view)
 *  └─ library-body-row
 *      ├─ library-list-pane (BibEntryList variant or a state block:
 *      │    empty → library-empty-state / no-results → '__query__' block /
 *      │    trash∅ → "No references in Trash" / error → retry block)
 *      └─ BibEntryPreview (renders its own -contained -open panel)
 *  └─ toasts (fixed host, context-owned, incl. View Trash action)
 * ```
 *
 * State lives in `useLibrary`; this file is markup + wiring only.
 * View tabs are client-side (`setView` re-loads with the `trashed` flag).
 * Preview edits are flush-on-leave (OQ-7, same as the in-project editor):
 * the last form report is saved when the preview closes or navigates.
 */
import React, {
  useCallback,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  OLDropdown,
  OLDropdownItem,
  OLDropdownMenu,
  OLDropdownToggle,
} from '@/shared/components/ol/ol-dropdown-menu'
import OLButton from '@/shared/components/ol/ol-button'
import {
  OLModal,
  OLModalBody,
  OLModalFooter,
  OLModalHeader,
  OLModalTitle,
} from '@/shared/components/ol/ol-modal'
import BibEntryList from '../components/bib-entry-list'
import BibEntryPreview from '../components/bib-entry-preview'
import BibImportModal from '../components/bib-import-modal'
import OrcidPickerModal from '../../../deps/orcid-picker/frontend/js/components/orcid-picker-modal'
import ZoteroPickerModal from '../../../deps/zotero/frontend/js/components/zotero-picker-modal'
import MendeleyPickerModal from '../../../deps/mendeley/frontend/js/components/mendeley-picker-modal'
import { useBibServices } from '../utils/provider-status'
import LibraryManualModal from './library-manual-modal'
import * as api from './library-api'
import { useLibrary } from './library-context'
import { normaliseOrcidEntryKeys, splitImportText } from '../utils/bib-import'

type Report = {
  entry: { type: string; id: string; fields: Record<string, string> }
  originalId: string | null
}

export default function LibraryPage() {
  const { t } = useTranslation()

  const lib = useLibrary()
  const isTrash = lib.view === 'trash'

  const [importShow, setImportShow] = useState(false)
  const [uploadText, setUploadText] = useState('')
  const [manualShow, setManualShow] = useState(false)
  // P2: "Import from ORCID.org" (top-bar Add dropdown — orcid-picker modal).
  const [orcidOpen, setOrcidOpen] = useState(false)
  // P4: "Import from Zotero" (top-bar Add dropdown — zotero-picker modal).
  const [zoteroOpen, setZoteroOpen] = useState(false)
  // Mendeley picker (top-bar Add dropdown — mendeley-picker modal).
  const [mendeleyOpen, setMendeleyOpen] = useState(false)
  // Providers configured on the instance: hide unconfigured entries.
  const bibServices = useBibServices()
  const [confirmPermanent, setConfirmPermanent] = useState<string[] | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  // Last form report from the open preview (flush-on-leave, OQ-7).
  const lastReportRef = useRef<Report | null>(null)

  const visible = lib.visible
  const totalRows = lib.entries.length
  const selectedRow = lib.selected
  const selectedIds = lib.bulk
  const loadedKeys = useMemo(
    () => lib.entries.map(r => r.entry.id).filter(Boolean),
    [lib.entries]
  )

  // ---- add flows ---------------------------------------------------------
  const openPaste = useCallback(() => {
    setUploadText('')
    setImportShow(true)
  }, [])
  const openUpload = useCallback(() => {
    fileInputRef.current?.click()
  }, [])
  const handleFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      e.target.value = ''
      if (!file) return
      try {
        const text = await file.text()
        setUploadText(text)
        setImportShow(true)
      } catch (err) {
        lib.pushToast('error', t('Upload failed'))
        void err
      }
    },
    [lib, t]
  )
  const handleAddImported = useCallback(
    (entries: { type: string; id: string; fields: Record<string, string> }[]) => {
      void lib
        .addEntries(
          entries.map(e => ({
            key: e.id,
            type: e.type,
            fields: Object.entries(e.fields).map(([name, value]) => ({
              name,
              value,
            })),
          }))
        )
        .then(() => setImportShow(false))
    },
    [lib]
  )
  // P2: ORCID import — the modal already fetched the BibTeX of the
  // selected works; create them through the same library REST path as
  // the paste import (new-only mode: duplicate keys fail and are
  // reported by the modal's host, i.e. here: the modal stays open on
  // import failure and closes on success).
  const handleOrcidInserted = useCallback(
    (bibtexText: string) => {
      const entries = normaliseOrcidEntryKeys(
        splitImportText(bibtexText)
          .filter(i => i.kind === 'bibtex')
          .map(i => (i as { entry: { type: string; id: string; fields: Record<string, string> } }).entry)
      )
      setOrcidOpen(false)
      if (entries.length === 0) return
      void lib
        .addEntries(
          entries.map(e => ({
            key: e.id,
            type: e.type,
            fields: Object.entries(e.fields).map(([name, value]) => ({
              name,
              value,
            })),
          }))
        )
        .then(() => setImportShow(false))
    },
    [lib]
  )
  const handleManualSaved = useCallback(
    (apiEntries: {
      key: string
      type: string
      fields: { name: string; value: string }[]
    }[]) => lib.addEntries(apiEntries),
    [lib]
  )

  // ---- delete / restore flows -------------------------------------------
  const handleListDelete = useCallback(() => {
    if (isTrash) {
      setConfirmPermanent([...selectedIds])
    } else {
      void lib.trashEntries(selectedIds)
    }
  }, [isTrash, lib, selectedIds])

  const handlePreviewDelete = useCallback(() => {
    if (!selectedRow) return
    if (isTrash) {
      setConfirmPermanent([selectedRow.rowId])
    } else {
      void lib.trashEntries([selectedRow.rowId])
    }
  }, [isTrash, lib, selectedRow])

  const handleConfirmPermanent = useCallback(async () => {
    if (!confirmPermanent) return
    await lib.permanentDelete(confirmPermanent)
    setConfirmPermanent(null)
  }, [confirmPermanent, lib])

  // ---- preview report + flush-on-leave (OQ-7) ----------------------------
  const handlePreviewFormChange = useCallback(
    (entry: { type: string; id: string; fields: Record<string, string> }, originalId: string | null) => {
      lastReportRef.current = { entry, originalId }
    },
    []
  )
  const flushPreview = useCallback(
    async (leaveTo: (dir: -1 | 0 | 1) => void) => {
      const report = lastReportRef.current
      lastReportRef.current = null
      if (report && report.originalId) {
        const fieldEntries = Object.entries(report.entry.fields).map(
          ([name, value]) => ({ name, value: String(value ?? '') })
        )
        // Ship the key as the user sees it in the form: a rename now takes
        // effect (previously silently dropped); a cleared key keeps the
        // original (library entries are key-validated server-side).
        const key = report.entry.id.trim()
        // Address the EXACT row: the currently open preview row's stable id
        // (Mongo _id when the list has one) disambiguates duplicate keys.
        const targetRowId = lib.selected?.rowId || report.originalId
        const err = await lib.saveEntry(targetRowId, report.originalId, {
          key: key || undefined,
          type: report.entry.type,
          fields: fieldEntries,
        })
        if (err) lib.pushToast('error', err)
      }
      leaveTo(0)
    },
    [lib]
  )
  const handlePreviewClose = useCallback(
    () => void flushPreview(() => lib.select(null)),
    [flushPreview, lib]
  )

  const handleSingleDownload = useCallback(() => {
    if (selectedRow) {
      api.triggerDownload({ ids: [selectedRow.rowId] })
    }
  }, [selectedRow])

  // ---- render ------------------------------------------------------------
  return (
    <div className="library-page-main">
      <div className="library-toolbar d-flex flex-column">
        <div className="library-heading-row d-flex align-items-center">
          <h1 className="library-heading" id="library-heading">
            {isTrash ? t('Trash') : t('Library')}
          </h1>
          <nav className="trash-page-tabs" aria-label={t('Library')}>
            <a
              className="trash-page-tabs-link btn"
              onClick={e => {
                e.preventDefault()
                lib.setView('library')
              }}
              href="/library"
              aria-current={!isTrash ? 'page' : undefined}
            >
              {t('Library')}
            </a>
            <a
              className="trash-page-tabs-link btn"
              onClick={e => {
                e.preventDefault()
                lib.setView('trash')
              }}
              href="/library/trashed"
              aria-current={isTrash ? 'page' : undefined}
            >
              {t('Trash')}
            </a>
          </nav>
        </div>
        <div className="library-toolbar-actions d-flex align-items-center">
          <div
            className="bibtex-search form-control-wrapper"
            style={{ flexGrow: 1, marginRight: 'auto' }}
          >
            <input
              type="search"
              className="bibtex-search-input form-control"
              aria-label={
                isTrash ? t('Search in trashed references') : t('Search in your library')
              }
              placeholder={
                isTrash ? t('Search in trashed references') : t('Search in your library')
              }
              value={lib.search}
              onChange={e => lib.setSearch(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Escape') {
                  lib.setSearch('')
                  ;(e.target as HTMLInputElement).blur()
                }
              }}
            />
          </div>
          {
            !isTrash && (
              <div className="library-toolbar-buttons">
                <div className="bibtex-add-button dropdown">
              <OLDropdown align="end">
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
                  <OLDropdownItem
                    description={t('BibTeX, DOI')}
                    onClick={openPaste}
                  >
                    {t('Paste references')}
                  </OLDropdownItem>
                  <OLDropdownItem
                    description={t('.bib file')}
                    onClick={openUpload}
                  >
                    {t('Upload .bib file')}
                  </OLDropdownItem>
                  <OLDropdownItem onClick={() => setManualShow(true)}>
                    {t('Enter manually')}
                  </OLDropdownItem>
                  {/* P2 — "Import from ORCID.org" (BIB_ORCID_TEMPLATES_PLAN.md) */}
                  <OLDropdownItem
                    description={t('Search ORCID by name or iD')}
                    onClick={() => setOrcidOpen(true)}
                  >
                    {t('Import from ORCID.org')}
                  </OLDropdownItem>
                  {/* P4 — "Import from Zotero" (user's linked Zotero) — hidden
                      when the connector is not configured on this site. */}
                  {bibServices.zotero !== false ? (
                    <OLDropdownItem
                      description={t('Browse your Zotero libraries and import items')}
                      onClick={() => setZoteroOpen(true)}
                    >
                      {t('Import from Zotero')}
                    </OLDropdownItem>
                  ) : null}
                  {/* Mendeley — hidden when the connector is not configured. */}
                  {bibServices.mendeley !== false ? (
                    <OLDropdownItem
                      description={t('Browse your Mendeley library and import items')}
                      onClick={() => setMendeleyOpen(true)}
                    >
                      {t('Import from Mendeley')}
                    </OLDropdownItem>
                  ) : null}
                </OLDropdownMenu>
              </OLDropdown>
            </div>
            </div>
          )}
        </div>
      </div>

      {isTrash && totalRows > 0 && (
        <div className="library-trash-notification">
          {t(
            'References you delete will be kept here for 30 days before being permanently removed.'
          )}
        </div>
      )}

      <div className="library-body-row d-flex">
        {/* NOTE: the pane is a layout wrapper only. The inner BibEntryList
            root carries `.bibtex-entry-list` (and its `overflow: scroll`).
            Adding the list class here too created two nested scrollbars. */}
        <div className="library-list-pane flex-fill">
          {lib.loadError && totalRows === 0 ? (
            <div className="library-empty-state">
              <div className="bib-list-empty" role="alert">
                <div className="library-empty-state-heading">
                  {t(
                    'References couldn’t be loaded. Refresh the page to try again.'
                  )}
                </div>
                <OLButton
                  variant="primary"
                  size="sm"
                  onClick={() => void lib.refresh()}
                >
                  {t('Retry')}
                </OLButton>
              </div>
            </div>
          ) : totalRows === 0 && !isTrash ? (
            <div className="library-empty-state">
              {/* R8: the SaaS empty-1.png raster is not a CE asset — inline
                  book-stack icon instead (same visual role). */}
              <svg
                className="library-empty-state-image"
                width="120"
                height="90"
                viewBox="0 0 120 90"
                fill="none"
                aria-hidden="true"
              >
                <rect x="18" y="30" width="14" height="52" rx="2" fill="#c9d6e7" />
                <rect x="36" y="22" width="14" height="60" rx="2" fill="#a9c0dd" />
                <rect x="54" y="34" width="14" height="48" rx="2" fill="#c9d6e7" />
                <rect
                  x="72"
                  y="18"
                  width="14"
                  height="64"
                  rx="2"
                  fill="#8aa8cc"
                  transform="rotate(6 79 50)"
                />
                <circle cx="100" cy="66" r="16" fill="#f0f4fa" />
                <path
                  d="M94 66h12M100 60v12"
                  stroke="#5a7ea6"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                />
              </svg>
              <div className="bib-list-empty" role="alert">
                <div className="library-empty-state-heading">
                  {t('Add reference')}
                </div>
                <div className="library-empty-state-body">
                  {t(
                    'Add references to Library once and insert them into any project.'
                  )}
                </div>
                <button
                  type="button"
                  className="library-empty-state-add-btn btn btn-primary btn-sm"
                  onClick={openPaste}
                >
                  {t('Add reference')}
                </button>
              </div>
            </div>
          ) : totalRows === 0 && isTrash ? (
            <div className="library-empty-state">
              <div className="bib-list-empty" role="alert">
                <div className="library-empty-state-heading">
                  {t('No references in Trash')}
                </div>
              </div>
            </div>
          ) : visible.length === 0 ? (
            <div className="library-empty-state">
              <div className="bib-list-empty">
                <div className="library-empty-state-heading">
                  {t('No results for ‘__query__’', { query: lib.search })}
                </div>
                <div className="library-empty-body" role="alert">
                  {t('Try a different term (or add a new reference).')}
                </div>
                <button
                  type="button"
                  className="library-empty-state-add-btn btn btn-primary btn-sm"
                  onClick={() => lib.setSearch('')}
                >
                  {t('clear_search')}
                </button>
              </div>
            </div>
          ) : (
            <BibEntryList
              entries={visible.map(r => ({ ...r.entry, libId: r.rowId || undefined }))}
              onSelect={entry => {
                const row = visible.find(r => r.entry.libId === entry.libId)
                if (row) lib.select(row.rowId)
              }}
              previewId={lib.selection}
              selectedIds={selectedIds}
              onToggleSelect={lib.toggleBulk}
              onToggleSelectAll={kind => lib.setBulkAll(kind === 'all')}
              openDocName=""
              onAddPaste={openPaste}
              onAddManual={() => setManualShow(true)}
              variant={isTrash ? 'trash' : 'library'}
              hideToolbar
              showUpdatedAt
              rowIdOf={entry => entry.libId ?? entry.id}
              duplicateIds={lib.duplicateKeyIds}
              onBulkRestore={
                isTrash ? () => void lib.restoreEntries(selectedIds) : undefined
              }
              onBulkDelete={handleListDelete}
              bulkDeleteLabel={isTrash ? t('Delete permanently') : t('delete')}
            />
          )}
          {lib.hasMore && totalRows > 0 && (
            <div className="library-list-load-more">
              <button
                type="button"
                className="btn btn-sm btn-secondary"
                disabled={lib.loading}
                onClick={() => void lib.loadMore()}
              >
                {t('Load more')}
              </button>
            </div>
          )}
        </div>

        {selectedRow && (
          <BibEntryPreview
            key={selectedRow.rowId}
            entry={selectedRow.entry}
            entries={visible.map(r => ({ id: r.rowId }))}
            previewIndex={Math.max(lib.previewIndex, 0)}
            onPrev={() =>
              void flushPreview(() => lib.stepPreview(-1)).then(() =>
                void 0
              )
            }
            onNext={() =>
              void flushPreview(() => lib.stepPreview(1)).then(() => void 0)
            }
            onClose={handlePreviewClose}
            onDownload={handleSingleDownload}
            onDelete={handlePreviewDelete}
            onFormChange={handlePreviewFormChange}
            existingIds={loadedKeys}
            canDelete
              resizerStorageKey="libraryResizer"
          />
        )}
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".bib,application/x-bibtex,text/plain"
        style={{ display: 'none' }}
        aria-hidden="true"
        tabIndex={-1}
        onChange={e => void handleFile(e)}
      />

      <BibImportModal
        show={importShow}
        existingIds={loadedKeys}
        expectedSource="library"
        onImport={handleAddImported}
        onHidden={() => setImportShow(false)}
        initialText={uploadText}
      />
      <LibraryManualModal
        show={manualShow}
        existingKeys={loadedKeys}
        onSaved={handleManualSaved}
        onHide={() => setManualShow(false)}
      />

      {/* P2: Import from ORCID (top-bar Add dropdown) */}
      <OrcidPickerModal
        show={orcidOpen}
        handleHide={() => setOrcidOpen(false)}
        onInsert={handleOrcidInserted}
      />

      {/* P4: Import from Zotero (top-bar Add dropdown) */}
      <ZoteroPickerModal
        show={zoteroOpen}
        handleHide={() => setZoteroOpen(false)}
        onInsert={handleOrcidInserted}
      />

      {/* Mendeley picker (top-bar Add dropdown) */}
      <MendeleyPickerModal
        show={mendeleyOpen}
        handleHide={() => setMendeleyOpen(false)}
        onInsert={handleOrcidInserted}
      />

      {/* Permanent-delete confirmation (SaaS wording). */}
      <OLModal
        show={confirmPermanent !== null}
        onHide={() => setConfirmPermanent(null)}
        data-testid="bib-library-permanent-delete-confirm"
      >
        <OLModalHeader>
          <OLModalTitle>
            {confirmPermanent?.length === 1
              ? t('Permanently delete this reference?')
              : t('Permanently delete __count__ references?', {
                  count: confirmPermanent?.length ?? 0,
                })}
          </OLModalTitle>
        </OLModalHeader>
        <OLModalBody>
          {t('This action cannot be undone.')}
        </OLModalBody>
        <OLModalFooter>
          <OLButton
            variant="secondary"
            onClick={() => setConfirmPermanent(null)}
          >
            {t('Cancel')}
          </OLButton>
          <OLButton
            variant="danger"
            onClick={() => void handleConfirmPermanent()}
          >
            {t('Delete permanently')}
          </OLButton>
        </OLModalFooter>
      </OLModal>

      {/* Toasts (context-owned; SaaS-style incl. the View Trash action). */}
      {lib.toasts.length > 0 && (
        <div className="library-toast-host" role="status" aria-live="polite">
          {lib.toasts.map(toast => (
            <div
              key={toast.id}
              className={`toast library-toast library-toast-${toast.type}`}
            >
              <span className="toast-body">{toast.content}</span>
              {toast.action && (
                <button
                  type="button"
                  className="library-toast-action"
                  onClick={() => {
                    toast.action?.onClick()
                    lib.dismissToast(toast.id)
                  }}
                >
                  {toast.action.label}
                </button>
              )}
              <button
                type="button"
                className="toast-close"
                aria-label={t('Close')}
                onClick={() => lib.dismissToast(toast.id)}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
