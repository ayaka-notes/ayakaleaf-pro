/**
 * "Enter manually" modal for the IN-PROJECT visual editor (item 3).
 *
 * SaaS parity: the in-project Add → "Enter manually" opens the same
 * "Add reference" modal the Library uses (shared BibEntryForm, kind 'new'),
 * instead of the old inline full-panel form. On save the entry is written
 * into the open document through the same guarded `writeEntry` (new) path
 * as the pre-modal inline flow — the host extension stays the single
 * writer. Save semantics are owned by the caller (onSave) so the project
 * keeps its own key-generation + guard rules.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  OLModal,
  OLModalBody,
  OLModalHeader,
  OLModalTitle,
} from '@/shared/components/ol/ol-modal'
import BibEntryForm from './bib-entry-form'
import type { BibEntry } from '../utils/bib-types'

type Props = {
  show: boolean
  existingIds: string[]
  /** Save a new entry (the panel routes it through writeEntry(new)). */
  onSave: (entry: BibEntry, kind: 'existing' | 'new') => void
  onHide: () => void
}

export default function BibManualModal({
  show,
  existingIds,
  onSave,
  onHide,
}: Props) {
  const { t } = useTranslation()
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (show) setSaving(false)
  }, [show])

  const handleFormChange = useCallback(
    (entry: BibEntry, _originalId: string | null) => {
      // Track the latest form state so save persists exactly this.
      latestRef.current = {
        type: entry.type,
        id: entry.id,
        fields: { ...entry.fields },
      }
    },
    []
  )
  const latestRef = useRef<BibEntry | null>(null)

  const handleChecked = useCallback(
    (entry: BibEntry, kind: 'existing' | 'new') => {
      if (kind !== 'new') return
      setSaving(true)
      try {
        onSave(entry, kind)
      } finally {
        setSaving(false)
      }
    },
    [onSave]
  )

  return (
    <OLModal
      show={show}
      onHide={onHide}
      data-testid="bib-manual-modal"
    >
      <OLModalHeader>
        <OLModalTitle>{t('Add reference')}</OLModalTitle>
      </OLModalHeader>
      <OLModalBody>
        <BibEntryForm
          key={show ? 'open' : 'closed'}
          entry={{ type: 'article', id: '', fields: {} }}
          kind="new"
          originalId={null}
          existingIds={existingIds}
          onFormChange={handleFormChange}
          onChecked={(e, k) => {
            // Save = write + close.
            handleChecked(e, k)
            if (k === 'new') onHide()
          }}
          onBack={onHide}
          submitText={saving ? '…' : t('Add')}
        />
      </OLModalBody>
    </OLModal>
  )
}
