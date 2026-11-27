/**
 * "Enter manually" modal (SaaS Library add flow, LIBRARY_PLAN.md §5).
 *
 * Anatomy (SaaS capture): title "Add reference"; the shared
 * `BibEntryForm` (variant 'modal', kind 'new') — 48-type selector,
 * citation-key helpers ("Unique key for citations, no spaces or special
 * characters" / "Auto-generated from the author and year, if left
 * blank"), per-type rows — with the form's footer (Back=Cancel,
 * Check=Add: `submitText` 'Add').
 *
 * Save semantics (SaaS): Check validates; an empty key is auto-generated
 * from the server's `citation-key-suggestions` (author/year base + taken
 * keys); a conflicting key is still ALLOWED by the SaaS model
 * (duplicates are flagged in the list, not rejected at write — R6).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  OLModal,
  OLModalBody,
  OLModalHeader,
  OLModalTitle,
} from '@/shared/components/ol/ol-modal'
import BibEntryForm from '../components/bib-entry-form'
import type { BibEntry } from '../utils/bib-types'
import { generateCitationKey } from '../utils/bib-parser'
import * as api from './library-api'
import { bibEntryToApi, pickSuggestedKey } from './library-model'

export type ManualSaveEntry = {
  key: string
  type: string
  fields: { name: string; value: string }[]
}

type Props = {
  show: boolean
  /** Keys already in the loaded library page (hint + suggestion dedupe) */
  existingKeys: string[]
  onSaved: (apiEntries: ManualSaveEntry[]) => Promise<void>
  onHide: () => void
}

export default function LibraryManualModal({
  show,
  existingKeys,
  onSaved,
  onHide,
}: Props) {
  const { t } = useTranslation()
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const formRef = useRef<{
    entry: BibEntry
    kind: 'existing' | 'new'
    originalId: string | null
  } | null>(null)

  // Reset error state per open (the modal stays mounted for OLModal).
  useEffect(() => {
    if (show) {
      formRef.current = null
      setSaveError(null)
      setSaving(false)
    }
  }, [show])

  const handleFormChange = useCallback(
    (entry: BibEntry, originalId: string | null) => {
      formRef.current = {
        entry: {
          type: entry.type,
          id: entry.id,
          fields: { ...entry.fields },
        },
        kind: originalId === null ? 'new' : 'existing',
        originalId,
      }
    },
    []
  )

  const handleChecked = useCallback(
    async (entry: BibEntry, kind: 'existing' | 'new') => {
      if (kind !== 'new') return
      const clean: BibEntry = {
        type: entry.type,
        id: entry.id.trim(),
        fields: { ...entry.fields },
      }
      // SaaS parity: an entry with only a type/key is savable; the
      // preview surfaces the "Required fields missing" warning instead.
      setSaving(true)
      setSaveError(null)
      try {
        let key = clean.id
        if (!key) {
          const base = generateCitationKey(clean.fields) || 'ref'
          const taken = new Set(existingKeys)
          let serverKeys: string[] = []
          try {
            serverKeys = await api.suggestedKeys(base, [...taken])
          } catch (err) {
            serverKeys = [] // endpoint failed → local pattern only
          }
          key = pickSuggestedKey(base, serverKeys, taken)
        }
        await onSaved([bibEntryToApi({ ...clean, id: key })])
        onHide()
      } catch (err) {
        setSaveError(
          err instanceof Error
            ? err.message
            : t('Sorry, something went wrong')
        )
      } finally {
        setSaving(false)
      }
    },
    [existingKeys, onSaved, onHide, t]
  )

  return (
    <OLModal show={show} onHide={onHide} data-testid="bib-library-manual-modal">
      <OLModalHeader>
        <OLModalTitle>{t('Add reference')}</OLModalTitle>
      </OLModalHeader>
      <OLModalBody>
        {/* key on show: fresh rebind per open (form state resets) */}
        <BibEntryForm
          key={show ? 'open' : 'closed'}
          entry={{ type: 'article', id: '', fields: {} }}
          kind="new"
          originalId={null}
          existingIds={existingKeys}
          onFormChange={handleFormChange}
          onChecked={handleChecked}
          onBack={onHide}
          submitText={saving ? '…' : t('Add')}
        />
        {saveError && (
          <div className="bib-form-error" role="alert">
            {saveError}
          </div>
        )}
      </OLModalBody>
    </OLModal>
  )
}
