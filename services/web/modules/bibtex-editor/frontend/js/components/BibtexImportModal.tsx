import { useMemo, useState } from 'react'
import {
  OLModal,
  OLModalBody,
  OLModalFooter,
  OLModalHeader,
  OLModalTitle,
} from '@/shared/components/ol/ol-modal'
import OLButton from '@/shared/components/ol/ol-button'
import OLFormGroup from '@/shared/components/ol/ol-form-group'
import OLFormLabel from '@/shared/components/ol/ol-form-label'
import OLFormControl from '@/shared/components/ol/ol-form-control'
import OLNotification from '@/shared/components/ol/ol-notification'
import MaterialIcon from '@/shared/components/material-icon'
import { BibEntry } from '../bibtex/bibtex-entry'
import { parseBibtex } from '../bibtex/bibtex-parser'

// Two-step import modal: paste BibTeX (or bare DOIs) -> Preview (resolves DOIs,
// parses) -> Import.

const DOI_RE = /^10\.\d{4,9}\/\S+$/

async function defaultResolveDoi(doi: string): Promise<string> {
  const res = await fetch(`https://doi.org/${encodeURIComponent(doi)}`, {
    headers: { Accept: 'application/x-bibtex' },
  })
  if (!res.ok) throw new Error(`DOI ${doi}: HTTP ${res.status}`)
  return res.text()
}

export default function BibtexImportModal({
  show,
  existingKeys,
  onImport,
  onCancel,
  onResolveDoi,
}: {
  show: boolean
  existingKeys: Set<string>
  onImport: (entries: BibEntry[]) => void
  onCancel: () => void
  onResolveDoi?: (doi: string) => Promise<string>
}) {
  const [step, setStep] = useState<'form' | 'preview'>('form')
  const [text, setText] = useState('')
  const [preview, setPreview] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [doiError, setDoiError] = useState(false)
  const [deselected, setDeselected] = useState<Set<string>>(new Set())

  const candidates = useMemo(() => parseBibtex(preview).entries, [preview])

  // Default-selected = every candidate not already in the library, minus any
  // the user explicitly unticked.
  const selectedEntries = candidates.filter(
    e => !deselected.has(e.id) && !existingKeys.has(e.key)
  )

  const toggle = (id: string) =>
    setDeselected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  const goToPreview = async () => {
    setBusy(true)
    setError('')
    setDoiError(false)
    try {
      // resolve any bare DOI lines to BibTeX first, then hand the whole blob
      // to the parser (production does DOI resolution during preview).
      const lines = text.split(/\s*[\n,]\s*/).map(s => s.trim())
      const dois = lines.filter(s => DOI_RE.test(s))
      const nonDoi = text
        .split(/\n/)
        .filter(l => !DOI_RE.test(l.trim()))
        .join('\n')
      let resolved = nonDoi
      if (dois.length > 0) {
        const resolver = onResolveDoi ?? defaultResolveDoi
        const results = await Promise.allSettled(dois.map(resolver))
        const ok = results
          .filter(
            (r): r is PromiseFulfilledResult<string> => r.status === 'fulfilled'
          )
          .map(r => r.value)
        if (results.some(r => r.status === 'rejected')) setDoiError(true)
        resolved = (resolved.trim() ? resolved + '\n\n' : '') + ok.join('\n\n')
      }
      setPreview(resolved)
      setDeselected(new Set())
      setStep('preview')
    } catch (e) {
      setError(String((e as Error).message || e))
    } finally {
      setBusy(false)
    }
  }

  const doImport = () => {
    if (selectedEntries.length) onImport(selectedEntries)
  }

  const back = () => setStep('form')
  const empty = candidates.length === 0

  return (
    <OLModal show={show} onHide={onCancel} size="lg" scrollable>
      {step === 'form' ? (
        <>
          <OLModalHeader closeButton>
            <OLModalTitle>Add reference</OLModalTitle>
          </OLModalHeader>
          <OLModalBody>
            <OLFormGroup>
              <OLFormLabel htmlFor="bibtex-import-input">Entries</OLFormLabel>
              <OLFormControl
                id="bibtex-import-input"
                as="textarea"
                rows={8}
                placeholder="Paste BibTeX entries here, or DOIs (one per line)…"
                value={text}
                onChange={e =>
                  setText((e.target as HTMLTextAreaElement).value)
                }
              />
            </OLFormGroup>
            {error && (
              <OLNotification type="error" content={error} className="mb-0" />
            )}
          </OLModalBody>
          <OLModalFooter>
            <OLButton variant="secondary" onClick={onCancel}>
              Cancel
            </OLButton>
            <OLButton
              variant="primary"
              onClick={goToPreview}
              disabled={busy || !text.trim()}
              isLoading={busy}
            >
              Preview
            </OLButton>
          </OLModalFooter>
        </>
      ) : (
        <>
          <OLModalHeader closeButton>
            <OLButton
              variant="ghost"
              onClick={back}
              className="ps-0"
              aria-label="Back"
            >
              <MaterialIcon type="arrow_back" /> Back
            </OLButton>
            <OLModalTitle className="visually-hidden">Preview</OLModalTitle>
          </OLModalHeader>
          <OLModalBody>
            {empty ? (
              <div className="bibtex-import-preview-empty">
                No references found
              </div>
            ) : (
              <>
                <div className="bibtex-import-preview-count">
                  {candidates.length}{' '}
                  {candidates.length === 1 ? 'new reference' : 'new references'}
                </div>
                <div className="bibtex-import-preview-list">
                  {candidates.map(entry => {
                    const dup = existingKeys.has(entry.key)
                    return (
                      <label
                        key={entry.id}
                        className={
                          'bibtex-import-preview-card' +
                          (dup ? ' bibtex-already-in-library' : '')
                        }
                      >
                        <div className="bibtex-import-preview-card-heading">
                          <input
                            type="checkbox"
                            checked={!deselected.has(entry.id) && !dup}
                            disabled={dup}
                            onChange={() => toggle(entry.id)}
                          />
                          <span className="bibtex-import-preview-card-key">
                            {entry.key || '(no key)'}
                          </span>
                          <span className="bibtex-import-preview-card-tags">
                            {entry.type}
                            {dup ? ' · already in library' : ''}
                          </span>
                        </div>
                        <div className="bibtex-import-preview-card-content">
                          <div>{entry.getTitle() || '(no title)'}</div>
                          <div>
                            {entry.getAuthors().summarize()}
                            {entry.getYear() ? ` (${entry.getYear()})` : ''}
                          </div>
                        </div>
                      </label>
                    )
                  })}
                </div>
              </>
            )}
            {doiError && (
              <OLNotification
                type="warning"
                content="Some DOIs could not be resolved"
                className="mt-3 mb-0"
              />
            )}
          </OLModalBody>
          <OLModalFooter>
            <OLButton variant="secondary" onClick={onCancel}>
              Cancel
            </OLButton>
            {!empty && (
              <OLButton
                variant="primary"
                onClick={doImport}
                disabled={selectedEntries.length === 0}
              >
                Import{' '}
                {selectedEntries.length > 0 ? `(${selectedEntries.length})` : ''}
              </OLButton>
            )}
          </OLModalFooter>
        </>
      )}
    </OLModal>
  )
}
