/**
 * Form component for editing a single BibTeX entry (Phase C capture
 * anatomy, PHASE_C_PLAN.md §1.2/§1.4/§1.5 — captures win over Phase B).
 *
 * Anatomy (both hosts):
 *   [DOI import row (modal host only)]
 *   Entry type (48-type dropdown from overleaf-type-map)
 *   Citation key  (+ capture helper lines)
 *   per-type main fields (CAPTURED_FORM_ROWS.mainFields)
 *   Year
 *   Date
 *   per-type postDate rows (unpublished: Note; electronic/online/www: DOI…)
 *   Optional (collapsed) → valued optional rows + "Add field" combobox
 *   host-provided footer (modal host: Back/Delete + Check; inplace host: none)
 *
 * abstract is NOT a form row — the Abstract tab (C4) owns it; optional
 * contents are DYNAMIC (valued ∪ added), not the Phase B defaultOptional
 * list (that diff IS the spec — plan §5 risk register).
 *
 * Write path unchanged: the guarded write + flush-on-leave (W1/W2/W3, R2)
 * live in the panel/context — this component only reports form state.
 */
import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import OLButton from '@/shared/components/ol/ol-button'
import OLIconButton from '@/shared/components/ol/ol-icon-button'
import OLTooltip from '@/shared/components/ol/ol-tooltip'
import OLFormLabel from '@/shared/components/ol/ol-form-label'
import OLFormText from '@/shared/components/ol/ol-form-text'
import OLFormControl from '@/shared/components/ol/ol-form-control'
import {
  OLDropdown,
  OLDropdownToggle,
  OLDropdownMenu,
  OLDropdownItem,
} from '@/shared/components/ol/ol-dropdown-menu'
import { generateCitationKey } from '../utils/bib-parser'
import { fetchEntryFromDoi } from '../utils/doi-fetcher'
import {
  ENTRY_TYPES,
  getEntryType,
  formRowsFor,
  optionalVisibleFor,
  requiredStarMembers,
  flattenRequired,
  isFormRebind,
} from '../utils/bib-types'
import {
  OPTIONAL_FIELD_TAXONOMY,
  offeredOptionalFields,
} from '../utils/overleaf-type-map.ts'
import { validateEntry } from '../utils/bib-validate'
import { helperKeyForField } from '../utils/bib-form-helper'
import type { BibEntry } from '../utils/bib-types'

type Props = {
  /** The entry values the form starts from */
  entry: BibEntry
  kind: 'existing' | 'new'
  /** For 'existing': the citation key as parsed from the document */
  originalId: string | null
  /** IDs of all existing entries (citation-key collision hints) */
  existingIds?: string[]
  /** Called on every form-state change (panel flush bookkeeping) */
  onFormChange: (entry: BibEntry, originalId: string | null) => void
  /** Called when Check is pressed (new: also materializes) */
  onChecked?: (
    entry: BibEntry,
    kind: 'existing' | 'new',
    originalId: string | null
  ) => void
  onDelete?: () => void
  onBack?: () => void
  /**
   * 'modal' (default): DOI import row + Back/Check footer (Add dialog host,
   * C5 "Enter manually"). 'inplace' (C4 preview): no footer, no DOI row —
   * commits are flush-on-leave through the host (OQ-7, same as today's R2).
   */
  variant?: 'modal' | 'inplace'
  /** Hide the modal footer (host renders its own) — default false. */
  hideFooter?: boolean
  /** Primary footer button label (default t('Check')). */
  submitText?: string
}

/** Display labels for field rows (DATA, not i18n — same decision as the
 * C1 type labels; labels are captured overleaf.com strings). */
const FIELD_DISPLAY_LABELS: Record<string, string> = {
  author: 'Author',
  editor: 'Editor',
  editora: 'Editor A',
  editorb: 'Editor B',
  editorc: 'Editor C',
  title: 'Title',
  subtitle: 'Subtitle',
  titleaddon: 'Title addon',
  journal: 'Journal',
  journaltitle: 'Journal title',
  year: 'Year',
  date: 'Date',
  publisher: 'Publisher',
  booktitle: 'Book title',
  chapter: 'Chapter',
  pages: 'Pages',
  institution: 'Institution',
  school: 'School',
  number: 'Number',
  type: 'Type',
  note: 'Note',
  doi: 'Digital object identifier (DOI)',
  eprint: 'Eprint',
  url: 'URL',
  language: 'Language',
  volume: 'Volume',
  volumes: 'Volumes',
  edition: 'Edition',
}

/** Human-readable (data) field labels for messages/tooltips */
function fieldLabel(name: string): string {
  return (
    FIELD_DISPLAY_LABELS[name] ||
    name.charAt(0).toUpperCase() + name.slice(1)
  )
}

const LARGE_FIELDS = new Set(['abstract', 'note', 'keywords'])

export default function BibEntryForm({
  entry,
  kind,
  originalId,
  existingIds = [],
  onFormChange,
  onChecked,
  onDelete,
  onBack,
  variant = 'modal',
  hideFooter = false,
  submitText,
}: Props) {
  const { t } = useTranslation()

  const [type, setType] = useState(entry.type || 'article')
  const [id, setId] = useState(entry.id || '')
  const [fields, setFields] = useState<Record<string, string>>({
    ...entry.fields,
  })
  const [optionalExpanded, setOptionalExpanded] = useState(false)
  const [checked, setChecked] = useState(false)
  // Optional rows added via the "Add field" combobox this session (C2:
  // Optional is dynamic = valued ∪ added; resets on re-sync).
  const [addedOptionals, setAddedOptionals] = useState<string[]>([])
  // Notify the panel on every form change (flush bookkeeping).
  useEffect(() => {
    onFormChange({ type, id, fields }, kind === 'existing' ? originalId : null)
  }, [type, id, fields, kind, originalId, onFormChange])

  // Re-sync from the parsed entry when a different entry is opened
  // (selection change remounts the form — this effect covers it).
  // W3a (§12 P3): a REBIND (parse-confirmed write: new→existing or a
  // rename) re-shows Check results immediately — `checked` is recomputed
  // from the written values (re-validate, no re-press).
  const [entrySig, setEntrySig] = useState(
    () => `${kind}:${originalId ?? ''}:${JSON.stringify(entry)}`
  )
  const lastBoundRef = useRef({ kind, originalId })
  useEffect(() => {
    const sig = `${kind}:${originalId ?? ''}:${JSON.stringify(entry)}`
    if (sig !== entrySig) {
      const rebind = isFormRebind(lastBoundRef.current, { kind, originalId })
      lastBoundRef.current = { kind, originalId }
      setEntrySig(sig)
      setType(entry.type || 'article')
      setId(entry.id || '')
      setFields({ ...entry.fields })
      setOptionalExpanded(false)
      setAddedOptionals([])
      setChecked(rebind)
    }
  }, [entry, kind, originalId, entrySig])

  // DOI fetch state (modal host only)
  const [doiInput, setDoiInput] = useState(entry.fields.doi || '')
  const [doiFetching, setDoiFetching] = useState(false)
  const [doiFetchError, setDoiFetchError] = useState<string | null>(null)
  const [doiFetchSuccess, setDoiFetchSuccess] = useState(false)

  const handleFetchDoi = useCallback(async () => {
    const rawDoi = doiInput.trim()
    if (!rawDoi) return
    setDoiFetching(true)
    setDoiFetchError(null)
    setDoiFetchSuccess(false)
    try {
      const fetched = await fetchEntryFromDoi(rawDoi)
      setType(fetched.type)
      setFields(prev => ({
        ...prev,
        ...fetched.fields,
        doi: fetched.fields.doi || rawDoi,
      }))
      setDoiFetchSuccess(true)
    } catch (err) {
      setDoiFetchError(
        err instanceof Error ? err.message : t('Failed to fetch DOI')
      )
    } finally {
      setDoiFetching(false)
    }
  }, [doiInput, t])

  const entryTypeDef = getEntryType(type)

  // Live validation (pure): stars + per-field Check messages.
  const starMembers = entryTypeDef
    ? new Set(requiredStarMembers(entryTypeDef.requiredFields, fields))
    : new Set<string>()

  const checkResult = checked
    ? validateEntry({ type, id, fields }, kind)
    : null

  // C2 captured anatomy: main rows → Year → Date → postDate rows.
  const mainRows = formRowsFor(type, fields)
  const optionalRows = optionalVisibleFor(type, fields, addedOptionals)
  const offeredFields = useMemo(
    () =>
      offeredOptionalFields(
        type,
        entryTypeDef?.requiredFields ?? []
      ).filter(
        f =>
          !optionalRows.includes(f.field) &&
          !mainRows.includes(f.field)
      ),
    [type, entryTypeDef?.requiredFields, optionalRows, mainRows]
  )

  const requiredStarSet = starMembers

  const handleFieldChange = useCallback((name: string, value: string) => {
    setFields(prev => {
      const next = { ...prev }
      if (value.trim()) {
        next[name] = value
      } else {
        delete next[name]
      }
      return next
    })
  }, [])

  const handleGenerateKey = useCallback(() => {
    const base = generateCitationKey(fields)
    // When editing, the current entry's own ID is not a collision
    const otherIds = new Set(
      kind === 'new'
        ? existingIds
        : existingIds.filter(eid => eid !== originalId)
    )
    if (!otherIds.has(base)) {
      setId(base)
      return
    }
    for (const ch of 'bcdefghijklmnopqrstuvwxyz') {
      const candidate = `${base}${ch}`
      if (!otherIds.has(candidate)) {
        setId(candidate)
        return
      }
    }
    for (let n = 2; n < 1000; n++) {
      const candidate = `${base}${n}`
      if (!otherIds.has(candidate)) {
        setId(candidate)
        return
      }
    }
    setId(base)
  }, [fields, existingIds, kind, originalId])

  const handleCheck = useCallback(() => {
    setChecked(true)
    onChecked?.({ type, id: id.trim(), fields }, kind, originalId)
  }, [type, id, fields, kind, originalId, onChecked])

  const handleTypeChange = useCallback((name: string) => {
    setType(name)
    setChecked(false)
    setAddedOptionals([])
  }, [])

  const handleAddOptional = useCallback((field: string) => {
    setAddedOptionals(prev =>
      prev.includes(field) ? prev : [...prev, field]
    )
  }, [])

  const selectedType = ENTRY_TYPES.find(et => et.name === type)

  // Field message after Check.
  //   standalone missing → "<Label> is required"
  //   OR-group missing   → "Either A or B is required" (one per empty member)
  const messageFor = (fieldName: string): string | null => {
    if (!checkResult) {
      return null
    }
    const msg = checkResult.byField[fieldName]
    if (!msg) {
      return null
    }
    switch (msg.kind) {
      case 'required-missing': {
        const a = msg.labelFields[0]
        const b = msg.labelFields[1]
        if (msg.group && a && b !== undefined) {
          return t('Either __a__ or __b__ is required', {
            a: fieldLabel(a),
            b: fieldLabel(b),
          })
        }
        return t('__a__ is required', { a: fieldLabel(fieldName) })
      }
      case 'id-required':
        return t('Citation key is required')
      case 'id-invalid':
        return t('Citation key contains invalid characters')
      case 'year-format':
        return t('Year should be a 4-digit number')
      case 'doi-format':
        return t('DOI format looks invalid')
      case 'url-invalid':
        return t('URL looks invalid')
      default:
        return null
    }
  }

  // Per-row helper line (C2 §1.2). The mapping is a tested pure function
  // (utils/bib-form-helper.ts). Author/Editor intentionally have NO helper:
  // the `Separate multiple names with "and"` line was user-reported as a
  // stray string and removed (plan §2.4, 2026-08-28).
  const rowHelper = (fieldName: string): string | null => {
    const key = helperKeyForField(fieldName)
    return key ? t(key) : null
  }

  // Focus D3: on opening an entry, focus the first empty required field,
  // falling back to the citation key.
  const focusOnceRef = useRef(false)
  useEffect(() => {
    if (focusOnceRef.current) return
    focusOnceRef.current = true
    const firstEmpty = flattenRequired(
      getEntryType(type)?.requiredFields || []
    ).find(f => !fields[f]?.trim())
    const targetId =
      firstEmpty === 'author'
        ? 'bib-field-author-0'
        : firstEmpty
        ? `bib-field-${firstEmpty}`
        : 'bib-key'
    const raf = requestAnimationFrame(() => {
      document.getElementById(targetId)?.focus()
    })
    return () => cancelAnimationFrame(raf)
  }, [type, fields])

  // W2 (§2.7): Esc while typing in a form FIELD = back (Back flushes per
  // R2). Scoped to text inputs so the UI-kit dropdown's own Esc handling
  // is untouched.
  const handleFormKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key !== 'Escape') return
      const el = e.target
      if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
        return
      }
      e.preventDefault()
      e.stopPropagation()
      if (onBack) onBack()
    },
    [onBack]
  )

  const renderField = (fieldName: string) => {
    const isStarred = requiredStarSet.has(fieldName)
    const message = messageFor(fieldName)
    const helper = rowHelper(fieldName)
    const value = fields[fieldName] || ''
    return (
      <div className="form-group bib-form-row" key={fieldName}>
        <OLFormLabel
          className="bib-form-label"
          htmlFor={`bib-field-${fieldName}`}
        >
          {fieldLabel(fieldName)}
          {isStarred && (
            <span className="bib-form-required"> *</span>
          )}
        </OLFormLabel>
        {LARGE_FIELDS.has(fieldName) ? (
          <OLFormControl
            as="textarea"
            id={`bib-field-${fieldName}`}
            className={`bib-form-textarea ${
              message ? 'bib-form-input-error' : ''
            }`}
            maxLength={4096}
            autoComplete="off"
            type="text"
            value={value}
            onChange={e => handleFieldChange(fieldName, e.target.value)}
            rows={3}
          />
        ) : fieldName === 'author' ? (
          <BibAuthorField
            value={value}
            onChange={val => handleFieldChange(fieldName, val)}
            error={!!message}
          />
        ) : (
          <OLFormControl
            id={`bib-field-${fieldName}`}
            className={`bib-form-input ${
              message ? 'bib-form-input-error' : ''
            }`}
            maxLength={512}
            type="text"
            value={value}
            placeholder={helper || undefined}
            onChange={e => handleFieldChange(fieldName, e.target.value)}
          />
        )}
        {helper && <OLFormText>{helper}</OLFormText>}
        {message && (
          <span className="bib-form-error">{message}</span>
        )}
      </div>
    )
  }

  return (
    // W2 (§2.7): Esc while typing in a form FIELD = back to the list.
    // The form div is the bubbling target (repo pattern for
    // onKeyDown-on-div).
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div
      id="bibtex-entry-form"
      className="bibtex-entry-form bib-entry-form"
      onKeyDown={handleFormKeyDown}
    >
      {variant === 'modal' && (
        <>
          {/* DOI import row (modal host only — capture modals have no
              row; DOI Paste is C5, DOI single-fetch is Phase A). */}
          <div className="form-group bib-form-row">
            <OLFormLabel className="bib-form-label" htmlFor="bib-doi-import">
              {t('Import from DOI')}
            </OLFormLabel>
            <div className="bib-doi-row">
              <OLFormControl
                id="bib-doi-import"
                className="bib-form-input"
                maxLength={128}
                type="text"
                value={doiInput}
                onChange={e => {
                  setDoiInput(e.target.value)
                  setDoiFetchSuccess(false)
                  setDoiFetchError(null)
                }}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void handleFetchDoi()
                  }
                }}
                placeholder="10.1038/s41586-021-03819-2"
              />
              <OLButton
                variant="secondary"
                size="sm"
                disabled={doiFetching || !doiInput.trim()}
                onClick={() => void handleFetchDoi()}
              >
                {doiFetching ? '…' : t('Fetch')}
              </OLButton>
            </div>
            {doiFetchError && (
              <span className="bib-form-error">{doiFetchError}</span>
            )}
            {doiFetchSuccess && (
              <span className="bib-doi-success">
                {t('Fields populated from DOI')}
              </span>
            )}
          </div>

          <hr className="bib-form-divider" />
        </>
      )}

      {/* Entry type selector (48 — overleaf-type-map). SaaS DOM:
          form-control button + keyboard_arrow_down. */}
      <div className="form-group bib-form-row">
        <OLFormLabel className="bib-form-label" htmlFor="bib-type-dropdown">
          {t('Entry type')}
        </OLFormLabel>
        <div className="position-relative">
          <OLDropdown>
            <OLDropdownToggle
              id="bib-type-dropdown"
              className="form-control text-start d-flex justify-content-between align-items-center w-100 entry-type-selector-btn no-default-caret"
              aria-label={t('Choose entry type')}
            >
              <span>{selectedType?.label || 'Select'}</span>
              <span className="material-symbols" aria-hidden="true">
                keyboard_arrow_down
              </span>
            </OLDropdownToggle>

          <OLDropdownMenu flip={false}>
            {ENTRY_TYPES.map(et => (
              <OLDropdownItem
                key={et.name}
                active={et.name === type}
                onClick={() => handleTypeChange(et.name)}
              >
                {et.label}
              </OLDropdownItem>
            ))}
            </OLDropdownMenu>
          </OLDropdown>
        </div>
      </div>

      {/* Citation key (capture helpers) */}
      <div className="form-group bib-form-row">
        <OLFormLabel className="bib-form-label" htmlFor="bib-key">
          {t('Citation key')}
        </OLFormLabel>
        <div className="bib-form-key-row">
          <OLFormControl
            className={`bib-form-input ${
              checkResult?.byField.id ? 'bib-form-input-error' : ''
            }`}
            maxLength={128}
            autoComplete="off"
            type="text"
            id="bib-key"
            value={id}
            onChange={e => setId(e.target.value)}
            placeholder="e.g. smith2024"
          />
          <OLTooltip
            key="tooltip-generate"
            id="tooltip-generate"
            description={t('Auto-generate from author/year')}
            overlayProps={{ placement: 'top', trigger: ['hover', 'focus'] }}
          >
            <OLButton variant="secondary" size="sm" onClick={handleGenerateKey}>
              {t('Generate')}
            </OLButton>
          </OLTooltip>
        </div>
        <span className="bib-form-hint">
          {t('Unique key for citations, no spaces or special characters')}
        </span>
        <span className="bib-form-hint">
          {t('Auto-generated from the author and year, if left blank')}
        </span>
        {kind === 'existing' && checkResult?.byField.id && (
          <span className="bib-form-error">{messageFor('id')}</span>
        )}
      </div>

      {/* Per-type main fields → Year → Date → postDate (capture order) */}
      {mainRows.map(renderField)}

      {/* Collapsed Optional (dynamic): valued ∪ added rows + Add field */}
      <div className="bib-optional-section">
        <button
          type="button"
          className="bibtex-collapsible-heading"
          aria-expanded={optionalExpanded}
          aria-label={optionalExpanded ? t('Collapse Optional') : t('Expand Optional')}
          onClick={() => setOptionalExpanded(v => !v)}
        >
          <span className="bib-form-label">{t('Optional')}</span>
          <span className="material-symbols" aria-hidden="true">
            {optionalExpanded ? 'keyboard_arrow_up' : 'keyboard_arrow_down'}
          </span>
        </button>
        {optionalExpanded && (
          <div className="bib-optional-body">
            <div className="bib-add-field-row">
              <span className="form-label">{t('Add optional field')}</span>
              <BibAddFieldCombobox
                placeholder={t('Enter field name')}
                offered={offeredFields.map(f => f.field)}
                onSelect={handleAddOptional}
              />
            </div>
            {optionalRows.map(renderField)}
          </div>
        )}
      </div>

      {variant === 'modal' && !hideFooter && (
        /* Footer: Delete (existing only) on left, Back + Check on right */
        <div className="bib-form-footer">
          <div className="bib-form-footer-left">
            {kind === 'existing' && onDelete && (
              <OLButton variant="danger" size="sm" onClick={onDelete}>
                {t('delete')}
              </OLButton>
            )}
          </div>
          <div className="bib-form-footer-right">
            <OLButton variant="secondary" size="sm" onClick={onBack}>
              {t('back')}
            </OLButton>
            <OLButton variant="primary" size="sm" onClick={handleCheck}>
              {submitText ?? t('Check')}
            </OLButton>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * "Add field" combobox (C2 §1.5): an input with a grouped listbox of the
 * offered optional fields (8 groups from overleaf-type-map, per-type
 * excluded). Selecting a field adds it to the dynamic Optional rows.
 * (Capture uses downshift; minimal equivalent a11y: combobox input +
 * listbox/option roles, Enter selects the first match, Esc closes.)
 */
function BibAddFieldCombobox({
  placeholder,
  offered,
  onSelect,
}: {
  placeholder: string
  offered: string[]
  onSelect: (field: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const listboxId = useMemo(() => `bib-add-field-listbox-${Math.random().toString(36).slice(2)}`, [])

  // group the offered fields by taxonomy order + labels
  const groups = useMemo(() => {
    const byField = new Map(offered.map(f => [f, true]))
    return OPTIONAL_FIELD_TAXONOMY.map(g => ({
      label: g.label,
      fields: g.fields.filter(f => byField.has(f.field)),
    })).filter(g => g.fields.length > 0)
  }, [offered])
  const filtered = query.trim()
    ? groups
        .map(g => ({
          label: g.label,
          fields: g.fields.filter(f =>
            f.label.toLowerCase().includes(query.trim().toLowerCase())
          ),
        }))
        .filter(g => g.fields.length > 0)
    : groups

  const firstOffered = filtered.find(g => g.fields.length > 0)?.fields[0].field

  return (
    <div className="bib-add-field-combobox">
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-controls={listboxId}
        aria-expanded={open}
        aria-autocomplete="list"
        className="bib-form-input"
        placeholder={placeholder}
        value={query}
        onChange={e => {
          setQuery(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={e => {
          if (e.key === 'Escape') {
            setOpen(false)
            inputRef.current?.blur()
            return
          }
          if (e.key === 'Enter' && firstOffered) {
            e.preventDefault()
            onSelect(firstOffered)
            setQuery('')
            setOpen(false)
          }
        }}
      />
      {open && (
        <ul
          id={listboxId}
          role="listbox"
          className="bib-add-field-listbox"
        >
          {filtered.map((group, gi) => (
            <React.Fragment key={group.label}>
              {gi > 0 && <li aria-hidden="true" className="bib-combo-divider" />}
              <li role="group" aria-label={group.label} className="bib-combo-group">
                <span className="bib-combo-group-label">{group.label}</span>
                {group.fields.map(f => (
                  <button
                    key={f.field}
                    type="button"
                    role="option"
                    aria-selected={query === f.label ? true : undefined}
                    className="bib-combo-option"
                    onClick={() => {
                      onSelect(f.field)
                      setQuery('')
                      setOpen(false)
                      inputRef.current?.focus()
                    }}
                  >
                    {f.label}
                  </button>
                ))}
              </li>
            </React.Fragment>
          ))}
        </ul>
      )}
    </div>
  )
}

/**
 * Author field with "and"-separated author management.
 * Internal state handles empty rows; only serializes non-empty authors to
 * onChange. Supports reordering via up/down buttons.
 */
function BibAuthorField({
  value,
  onChange,
  error,
}: {
  value: string
  onChange: (v: string) => void
  error?: boolean
}) {
  const { t } = useTranslation()

  const parseAuthors = useCallback(
    (v: string) => (v ? v.split(/\s+and\s+/i).map(a => a.trim()) : ['']),
    []
  )

  const [authors, setAuthors] = useState<string[]>(() => parseAuthors(value))

  const prevValueRef = useRef(value)
  useEffect(() => {
    if (value !== prevValueRef.current) {
      prevValueRef.current = value
      setAuthors(parseAuthors(value))
    }
  }, [value, parseAuthors])

  const commit = (list: string[]) => {
    onChange(list.filter(a => a.trim()).join(' and '))
  }

  const setAuthorAt = (idx: number, val: string) => {
    const next = authors.map((a, i) => (i === idx ? val : a))
    setAuthors(next)
    commit(next)
  }

  const addAuthor = () => {
    setAuthors(prev => [...prev, ''])
  }

  const removeAuthor = (idx: number) => {
    const next = authors.length > 1 ? authors.filter((_, i) => i !== idx) : ['']
    setAuthors(next)
    commit(next)
  }

  const moveAuthor = (idx: number, dir: -1 | 1) => {
    const to = idx + dir
    if (to < 0 || to >= authors.length) return
    const next = [...authors]
    ;[next[idx], next[to]] = [next[to], next[idx]]
    setAuthors(next)
    commit(next)
  }

  return (
    <div className="bib-author-field">
      {authors.map((a, i) => (
        <div key={i} className="bib-author-row">
          <OLFormControl
            className={`bib-form-input ${error ? 'bib-form-input-error' : ''}`}
            maxLength={128}
            type="text"
            id={`bib-field-author-${i}`}
            value={a}
            onChange={e => setAuthorAt(i, e.target.value)}
            placeholder={t('Last, First')}
          />
          <div className="bib-author-actions">
            <OLIconButton
              icon="arrow_upward_alt"
              variant="secondary"
              size="sm"
              accessibilityLabel={t('Move up')}
              onClick={() => moveAuthor(i, -1)}
              disabled={i === 0}
            />
            <OLIconButton
              icon="arrow_downward_alt"
              variant="secondary"
              size="sm"
              accessibilityLabel={t('Move down')}
              onClick={() => moveAuthor(i, +1)}
              disabled={i === authors.length - 1}
            />
            <OLIconButton
              icon="close"
              variant="danger-ghost"
              size="sm"
              accessibilityLabel={t('Remove author')}
              onClick={() => removeAuthor(i)}
              disabled={authors.length === 1 && !a.trim()}
            />
          </div>
        </div>
      ))}
      <OLButton variant="secondary" size="sm" className="bib-author-add" onClick={addAuthor}>
        {t('Add author')}
      </OLButton>
    </div>
  )
}
