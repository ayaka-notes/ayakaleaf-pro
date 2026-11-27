/**
 * ORCID picker modal (ported from ../old-doi-orcid-picker, commit
 * e3c75ff517 — "Initial files"; restyled to the current Overleaf design
 * system, i18n added, import runs with bounded concurrency + progress,
 * client-side ORCID format validation).
 *
 * Flow:
 *   step 'search':  search by author name OR enter an ORCID iD directly
 *   step 'works':   list the author's public works, select some, Import
 *
 * The modal ends by calling `onInsert(bibtexText)` with the combined
 * BibTeX for the selected works (the host surface — project bib panel or
 * reference library — parses and writes it through its own guarded import
 * path). Partial failures import what fetched and keep the modal open
 * with a per-work error report.
 */
import { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  OLModal,
  OLModalHeader,
  OLModalTitle,
  OLModalBody,
  OLModalFooter,
} from '@/shared/components/ol/ol-modal'
import OLButton from '@/shared/components/ol/ol-button'
import OLFormGroup from '@/shared/components/ol/ol-form-group'
import OLFormControl from '@/shared/components/ol/ol-form-control'
import OLFormLabel from '@/shared/components/ol/ol-form-label'
import OLFormCheckbox from '@/shared/components/ol/ol-form-checkbox'
import Notification from '@/shared/components/notification'
import { getJSON } from '@/infrastructure/fetch-json'

type AuthorResult = {
  orcid: string
  givenNames: string
  familyNames: string
  institutionNames: string[]
}

type Work = {
  title: string
  year: string
  type: string
  doi: string | null
  putCode: number
}

type OrcidPickerModalProps = {
  show: boolean
  handleHide: () => void
  /** Host writes these BibTeX entries (raw text, combined). */
  onInsert: (bibtexText: string) => void
}

type Step = 'search' | 'works'

const ORCID_FORMAT = /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/
const IMPORT_CONCURRENCY = 4

function errorMessage(err: unknown, fallback: string) {
  if (err && typeof err === 'object') {
    const data = (err as { data?: { error?: string } }).data
    if (data?.error) return data.error
    if ((err as { message?: string }).message) {
      return (err as { message: string }).message
    }
  }
  return fallback
}

export default function OrcidPickerModal({
  show,
  handleHide,
  onInsert,
}: OrcidPickerModalProps) {
  const { t } = useTranslation()

  // -- step state --
  const [step, setStep] = useState<Step>('search')

  // -- search step --
  const [searchMode, setSearchMode] = useState<'name' | 'orcid'>('name')
  const [nameQuery, setNameQuery] = useState('')
  const [orcidInput, setOrcidInput] = useState('')
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [authors, setAuthors] = useState<AuthorResult[]>([])

  // -- works step --
  const [selectedOrcid, setSelectedOrcid] = useState<string | null>(null)
  const [selectedAuthorName, setSelectedAuthorName] = useState('')
  const [works, setWorks] = useState<Work[]>([])
  const [worksLoading, setWorksLoading] = useState(false)
  const [worksError, setWorksError] = useState<string | null>(null)
  const [selectedPutCodes, setSelectedPutCodes] = useState<Set<number>>(
    new Set()
  )

  // -- import state --
  const [importing, setImporting] = useState(false)
  const [importProgress, setImportProgress] = useState({ done: 0, total: 0 })
  const [importError, setImportError] = useState<string | null>(null)

  // -----------------------------------------------------------------------
  // Reset everything when the modal closes
  // -----------------------------------------------------------------------
  const handleClose = useCallback(() => {
    setStep('search')
    setSearchMode('name')
    setNameQuery('')
    setOrcidInput('')
    setSearchLoading(false)
    setSearchError(null)
    setAuthors([])
    setSelectedOrcid(null)
    setSelectedAuthorName('')
    setWorks([])
    setWorksLoading(false)
    setWorksError(null)
    setSelectedPutCodes(new Set())
    setImporting(false)
    setImportProgress({ done: 0, total: 0 })
    setImportError(null)
    handleHide()
  }, [handleHide])

  // -----------------------------------------------------------------------
  // Search by name
  // -----------------------------------------------------------------------
  const handleSearchByName = useCallback(async () => {
    if (!nameQuery.trim()) return
    setSearchError(null)
    setAuthors([])
    setSearchLoading(true)
    try {
      const data = await getJSON<{ results: AuthorResult[] }>(
        `/orcid-picker/search?q=${encodeURIComponent(nameQuery.trim())}`
      )
      setAuthors(data.results)
      if (data.results.length === 0) {
        setSearchError(t('No authors found'))
      }
    } catch (err) {
      setSearchError(errorMessage(err, t('Search failed')))
    } finally {
      setSearchLoading(false)
    }
  }, [nameQuery, t])

  // -----------------------------------------------------------------------
  // Pick an author (go to works step)
  // -----------------------------------------------------------------------
  const handlePickAuthor = useCallback(
    async (orcid: string, displayName: string) => {
      setSelectedOrcid(orcid)
      setSelectedAuthorName(displayName)
      setStep('works')
      setWorksError(null)
      setImportError(null)
      setWorks([])
      setSelectedPutCodes(new Set())
      setWorksLoading(true)
      try {
        const data = await getJSON<{ works: Work[] }>(
          `/orcid-picker/works?orcid=${encodeURIComponent(orcid)}`
        )
        setWorks(data.works)
        if (data.works.length === 0) {
          setWorksError(t('No works found for this author'))
        }
      } catch (err) {
        setWorksError(errorMessage(err, t('Failed to load works')))
      } finally {
        setWorksLoading(false)
      }
    },
    [t]
  )

  // -----------------------------------------------------------------------
  // Direct ORCID input
  // -----------------------------------------------------------------------
  const handleGoToWorksByOrcid = useCallback(async () => {
    const orcid = orcidInput.trim()
    if (!orcid) return
    if (!ORCID_FORMAT.test(orcid)) {
      setWorksError(null)
      setSearchError(t('ORCID iD format is invalid'))
      return
    }
    setSearchError(null)
    await handlePickAuthor(orcid, orcid)
  }, [orcidInput, handlePickAuthor, t])

  // -----------------------------------------------------------------------
  // Toggle a work selection (by put-code)
  // -----------------------------------------------------------------------
  const toggleWork = useCallback((putCode: number) => {
    setSelectedPutCodes(prev => {
      const next = new Set(prev)
      if (next.has(putCode)) {
        next.delete(putCode)
      } else {
        next.add(putCode)
      }
      return next
    })
  }, [])

  // Select / deselect all works
  const allSelected =
    works.length > 0 && works.every(w => selectedPutCodes.has(w.putCode))

  const toggleAll = useCallback(() => {
    if (allSelected) {
      setSelectedPutCodes(new Set())
    } else {
      setSelectedPutCodes(new Set(works.map(w => w.putCode)))
    }
  }, [allSelected, works])

  // -----------------------------------------------------------------------
  // Import selected works (bounded concurrency + progress)
  // -----------------------------------------------------------------------
  const handleImport = useCallback(async () => {
    if (selectedPutCodes.size === 0 || !selectedOrcid) return
    setImporting(true)
    setImportError(null)
    setImportProgress({ done: 0, total: selectedPutCodes.size })

    const bibtexEntries: string[] = []
    const errors: string[] = []
    let done = 0

    const queue = Array.from(selectedPutCodes)
    const fetchOne = async (putCode: number) => {
      const work = works.find(w => w.putCode === putCode)
      const label = work?.title || `put-code ${putCode}`
      try {
        const data = await getJSON<{ bibtex: string }>(
          `/orcid-picker/fetch-bib?orcid=${encodeURIComponent(selectedOrcid)}&putCode=${encodeURIComponent(String(putCode))}`
        )
        bibtexEntries.push(data.bibtex)
      } catch (err) {
        errors.push(`${label}: ${errorMessage(err, t('Could not be imported'))}`)
      }
      done += 1
      setImportProgress({ done, total: selectedPutCodes.size })
    }

    // Simple worker pool (4 in flight).
    const workers: Promise<void>[] = []
    for (let i = 0; i < IMPORT_CONCURRENCY && queue.length > 0; i += 1) {
      workers.push(
        (async () => {
          for (;;) {
            const next = queue.shift()
            if (next === undefined) return
            await fetchOne(next)
          }
        })()
      )
    }
    await Promise.all(workers)

    if (bibtexEntries.length > 0) {
      onInsert(bibtexEntries.join('\n\n'))
    }

    if (errors.length > 0) {
      setImportError(
        t('Some works could not be imported') +
          ` (${errors.length}): ${errors.join('; ')}`
      )
      setImporting(false)
    } else {
      handleClose()
    }
  }, [
    selectedPutCodes,
    selectedOrcid,
    works,
    onInsert,
    handleClose,
    t,
  ])

  // -----------------------------------------------------------------------
  // Key handlers
  // -----------------------------------------------------------------------
  const handleNameKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        void handleSearchByName()
      }
    },
    [handleSearchByName]
  )

  const handleOrcidKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        void handleGoToWorksByOrcid()
      }
    },
    [handleGoToWorksByOrcid]
  )

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------
  return (
    <OLModal show={show} onHide={handleClose} data-testid="orcid-picker-modal">
      <OLModalHeader closeButton>
        <OLModalTitle>
          {step === 'search'
            ? t('Import from ORCID')
            : t('Works', { author: selectedAuthorName })}
        </OLModalTitle>
      </OLModalHeader>

      <OLModalBody>
        {step === 'search' && (
          <>
            {/* Toggle between search-by-name and direct ORCID */}
            <div style={{ marginBottom: '12px' }} data-testid="orcid-mode-toggle">
              <OLButton
                variant={searchMode === 'name' ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => setSearchMode('name')}
                style={{ marginRight: '8px' }}
              >
                {t('Search by name')}
              </OLButton>
              <OLButton
                variant={searchMode === 'orcid' ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => {
                  setSearchMode('orcid')
                  setSearchError(null)
                }}
              >
                {t('Enter ORCID iD')}
              </OLButton>
            </div>

            {searchError && (
              <Notification
                type="error"
                content={searchError}
                isDismissible
                onDismiss={() => setSearchError(null)}
              />
            )}

            {searchMode === 'name' && (
              <>
                <OLFormGroup>
                  <OLFormLabel htmlFor="orcid-name-input">
                    {t('Author name')}
                  </OLFormLabel>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <OLFormControl
                      id="orcid-name-input"
                      type="text"
                      placeholder={t('e.g. Jane Smith')}
                      value={nameQuery}
                      onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                        setNameQuery(e.target.value)
                      }
                      onKeyDown={handleNameKeyDown}
                      disabled={searchLoading}
                    />
                    <OLButton
                      variant="primary"
                      onClick={() => void handleSearchByName()}
                      disabled={searchLoading || !nameQuery.trim()}
                      isLoading={searchLoading}
                    >
                      {t('Search')}
                    </OLButton>
                  </div>
                </OLFormGroup>

                {authors.length > 0 && (
                  <div
                    style={{
                      maxHeight: '300px',
                      overflowY: 'auto',
                      border: '1px solid var(--border-color)',
                      borderRadius: '4px',
                      marginTop: '8px',
                    }}
                    data-testid="orcid-authors"
                  >
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr
                          style={{
                            borderBottom: '1px solid var(--border-color)',
                            backgroundColor: 'var(--bg-light-secondary)',
                          }}
                        >
                          <th style={{ padding: '6px 10px', textAlign: 'left' }}>
                            {t('Name')}
                          </th>
                          <th
                            style={{ padding: '6px 10px', textAlign: 'left' }}
                          >
                            {t('ORCID iD')}
                          </th>
                          <th style={{ padding: '6px 10px', textAlign: 'left' }}>
                            {t('Affiliation')}
                          </th>
                          <th style={{ padding: '6px 10px' }} />
                        </tr>
                      </thead>
                      <tbody>
                        {authors.map(a => {
                          const display = [a.givenNames, a.familyNames]
                            .filter(Boolean)
                            .join(' ')
                          return (
                            <tr
                              key={a.orcid}
                              style={{
                                borderBottom: '1px solid var(--border-color)',
                                cursor: 'pointer',
                              }}
                              onClick={() =>
                                void handlePickAuthor(a.orcid, display || a.orcid)
                              }
                            >
                              <td style={{ padding: '6px 10px' }}>
                                {display || '(no name)'}
                              </td>
                              <td
                                style={{
                                  padding: '6px 10px',
                                  fontSize: '12px',
                                  fontFamily: 'monospace',
                                }}
                              >
                                {a.orcid}
                              </td>
                              <td style={{ padding: '6px 10px', fontSize: '12px' }}>
                                {a.institutionNames?.join(', ') || '—'}
                              </td>
                              <td style={{ padding: '6px 10px' }}>
                                <OLButton
                                  variant="ghost"
                                  size="sm"
                                  onClick={e => {
                                    e.stopPropagation()
                                    void handlePickAuthor(
                                      a.orcid,
                                      display || a.orcid
                                    )
                                  }}
                                >
                                  {t('Select')}
                                </OLButton>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}

            {searchMode === 'orcid' && (
              <OLFormGroup>
                <OLFormLabel htmlFor="orcid-id-input">{t('ORCID iD')}</OLFormLabel>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <OLFormControl
                    id="orcid-id-input"
                    type="text"
                    placeholder={t('e.g. 0000-0002-1825-0097')}
                    value={orcidInput}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setOrcidInput(e.target.value)
                    }
                    onKeyDown={handleOrcidKeyDown}
                    disabled={worksLoading}
                  />
                  <OLButton
                    variant="primary"
                    onClick={() => void handleGoToWorksByOrcid()}
                    disabled={worksLoading || !orcidInput.trim()}
                    isLoading={worksLoading}
                  >
                    {t('Load works')}
                  </OLButton>
                </div>
              </OLFormGroup>
            )}
          </>
        )}

        {step === 'works' && (
          <>
            <OLButton
              variant="ghost"
              size="sm"
              onClick={() => {
                setStep('search')
                setWorksError(null)
                setImportError(null)
              }}
              style={{ padding: 0, marginBottom: '8px' }}
              data-testid="orcid-back"
            >
              {t('Back to search')}
            </OLButton>

            {worksLoading && <p>{t('Loading works…')}</p>}

            {worksError && (
              <Notification
                type="error"
                content={worksError}
                isDismissible
                onDismiss={() => setWorksError(null)}
              />
            )}

            {importError && (
              <Notification
                type="warning"
                content={importError}
                isDismissible
                onDismiss={() => setImportError(null)}
              />
            )}

            {works.length > 0 && (
              <>
                <div style={{ marginBottom: '8px' }}>
                  <OLFormCheckbox
                    checked={allSelected}
                    onChange={toggleAll}
                    label={t('Select all (__count__)', { count: works.length })}
                  />
                </div>
                <div
                  style={{
                    maxHeight: '350px',
                    overflowY: 'auto',
                    border: '1px solid var(--border-color)',
                    borderRadius: '4px',
                  }}
                  data-testid="orcid-works"
                >
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr
                        style={{
                          borderBottom: '1px solid var(--border-color)',
                          backgroundColor: 'var(--bg-light-secondary)',
                        }}
                      >
                        <th style={{ padding: '6px 10px', width: '30px' }} />
                        <th style={{ padding: '6px 10px', textAlign: 'left' }}>
                          {t('Title')}
                        </th>
                        <th
                          style={{
                            padding: '6px 10px',
                            textAlign: 'left',
                            width: '60px',
                          }}
                        >
                          {t('Year')}
                        </th>
                        <th
                          style={{ padding: '6px 10px', textAlign: 'left' }}
                        >
                          {t('Type')}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {works.map((w, i) => (
                        <tr
                          key={w.putCode ?? i}
                          style={{
                            borderBottom: '1px solid var(--border-color)',
                          }}
                        >
                          <td style={{ padding: '6px 10px' }}>
                            <OLFormCheckbox
                              checked={selectedPutCodes.has(w.putCode)}
                              onChange={() => toggleWork(w.putCode)}
                              aria-label={w.title || t('Untitled')}
                            />
                          </td>
                          <td style={{ padding: '6px 10px' }}>
                            {w.title || t('Untitled')}
                          </td>
                          <td style={{ padding: '6px 10px', fontSize: '12px' }}>
                            {w.year || '—'}
                          </td>
                          <td style={{ padding: '6px 10px', fontSize: '12px' }}>
                            {w.type || '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </>
        )}
      </OLModalBody>

      {step === 'works' && works.length > 0 && (
        <OLModalFooter>
          <OLButton variant="secondary" onClick={handleClose}>
            {t('Cancel')}
          </OLButton>
          <OLButton
            variant="primary"
            onClick={() => void handleImport()}
            disabled={selectedPutCodes.size === 0 || importing}
            isLoading={importing}
          >
            {importing
              ? t('Importing __done__ of __total__…', {
                  done: importProgress.done,
                  total: importProgress.total,
                })
              : t('Import selected (__count__)', {
                  count: selectedPutCodes.size,
                })}
          </OLButton>
        </OLModalFooter>
      )}
    </OLModal>
  )
}
