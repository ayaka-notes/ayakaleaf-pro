/**
 * The visual BibTeX editor container.
 *
 * Layout, top to bottom:
 * - `.bibtex-toolbar` row: undo/redo button group on the left (when editable),
 *   injected right-side content (the Code/Visual switch) on the right
 * - `.bibtex-entry-list-panel`: entry count + search + Add dropdown, which
 *   switches to "N selected" + Delete when entries are checked
 * - the virtualized entry table
 *
 * Integration seam = the `value` / `onChange` pair:
 *   - `value`    = full text of the .bib document
 *   - `onChange` = called with the new full text after any edit
 */
import './bibtex-editor.css'
import React, { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BibEntry } from '../bibtex/bibtex-entry'
import {
  parseBibtex,
  serializeEntry,
  replaceEntryInSource,
} from '../bibtex/bibtex-parser'
import { useUndoableValue } from '../hooks/useUndoableValue'
import { BibtexEntryTable } from './BibtexEntryTable'
import BibtexEntryModal from './BibtexEntryModal'
import BibtexImportModal from './BibtexImportModal'
import {
  Dropdown,
  DropdownToggle,
  DropdownToggleCustom,
  DropdownMenu,
  DropdownItem,
} from '@/shared/components/dropdown/dropdown-menu'
import OLButton from '@/shared/components/ol/ol-button'
import OLFormControl from '@/shared/components/ol/ol-form-control'
import OLTooltip from '@/shared/components/ol/ol-tooltip'
import MaterialIcon from '@/shared/components/material-icon'
import { isMac } from '@/shared/utils/os'

export interface BibtexEditorProps {
  value: string
  onChange: (next: string) => void
  readOnly?: boolean
  /** name of the open .bib file, used in the search placeholder etc. */
  fileName?: string
  /** optional custom DOI -> BibTeX resolver for the import panel */
  onResolveDoi?: (doi: string) => Promise<string>
  /**
   * Rendered at the right of the editor toolbar row (the provider passes the
   * Code/Visual switch here).
   */
  toolbar?: React.ReactNode
}

type Mode =
  | { kind: 'idle' }
  | { kind: 'edit'; entry: BibEntry }
  | { kind: 'add' }
  | { kind: 'import' }

function removeEntryFromSource(source: string, entry: BibEntry): string {
  if (!entry.range) return source
  let { from, to } = entry.range
  while (to < source.length && (source[to] === '\n' || source[to] === '\r')) to++
  return source.slice(0, from) + source.slice(to)
}

function appendEntriesToSource(source: string, newEntries: BibEntry[]): string {
  if (newEntries.length === 0) return source
  const block = newEntries.map(e => serializeEntry(e)).join('\n\n')
  const sep = source.trim() === '' ? '' : '\n\n'
  return source.replace(/\s*$/, '') + sep + block + '\n'
}

// Toolbar icon button: an .ol-cm-toolbar-button with a "label + shortcut"
// tooltip, disabled via aria-disabled so the shared CSS opacity rules apply.
function BibtexToolbarButton({
  id,
  label,
  icon,
  shortcut,
  disabled,
  onClick,
}: {
  id: string
  label: string
  icon: 'undo' | 'redo'
  shortcut: string
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <OLTooltip
      id={id}
      description={
        <>
          <div>{label}</div>
          <div>{shortcut}</div>
        </>
      }
      overlayProps={{ placement: 'bottom' }}
    >
      <button
        type="button"
        id={id}
        className="ol-cm-toolbar-button"
        aria-label={label}
        aria-disabled={disabled || undefined}
        onClick={() => {
          if (!disabled) onClick()
        }}
      >
        <MaterialIcon type={icon} />
      </button>
    </OLTooltip>
  )
}

export function BibtexEditor({
  value,
  onChange,
  readOnly,
  fileName,
  onResolveDoi,
  toolbar,
}: BibtexEditorProps) {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const [mode, setMode] = useState<Mode>({ kind: 'idle' })
  const [checkedIds, setCheckedIds] = useState<Set<string>>(() => new Set())
  const { commit, undo, redo, canUndo, canRedo } = useUndoableValue(
    value,
    onChange
  )

  const { entries, duplicateKeys, existingKeys } = useMemo(() => {
    const res = parseBibtex(value)
    return {
      entries: res.entries,
      duplicateKeys: res.duplicateKeys,
      existingKeys: new Set(res.entries.map(e => e.key)),
    }
  }, [value])

  const searchTerms = useMemo(
    () => search.trim().toLowerCase().split(/\s+/).filter(Boolean),
    [search]
  )

  const filtered = useMemo(() => {
    if (searchTerms.length === 0) return entries
    return entries.filter(e => {
      const haystack = [
        e.key,
        e.getTitle(),
        e.getAuthors().join(),
        e.getYear(),
        e.type,
      ]
        .join(' ')
        .toLowerCase()
      return searchTerms.every(term => haystack.includes(term))
    })
  }, [entries, searchTerms])

  // drop selections for entries that no longer exist
  useEffect(() => {
    setCheckedIds(prev => {
      if (prev.size === 0) return prev
      const valid = new Set(entries.map(e => e.id))
      const next = new Set([...prev].filter(id => valid.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [entries])

  const handleCheckBoxChange = (entry: BibEntry) => {
    setCheckedIds(prev => {
      const next = new Set(prev)
      if (next.has(entry.id)) {
        next.delete(entry.id)
      } else {
        next.add(entry.id)
      }
      return next
    })
  }

  const handleCheckAllChange = () => {
    setCheckedIds(prev => {
      const all =
        filtered.length > 0 && filtered.every(e => prev.has(e.id))
      return all ? new Set() : new Set(filtered.map(e => e.id))
    })
  }

  const handleDelete = (entry: BibEntry) => {
    if (readOnly) return
    commit(removeEntryFromSource(value, entry))
  }

  // Ranges reference positions in `value`, so delete back to front to keep
  // the earlier ranges valid.
  const handleDeleteSelected = () => {
    if (readOnly) return
    const toDelete = entries
      .filter(e => checkedIds.has(e.id) && e.range)
      .sort((a, b) => b.range!.from - a.range!.from)
    let next = value
    for (const entry of toDelete) {
      next = removeEntryFromSource(next, entry)
    }
    commit(next)
    setCheckedIds(new Set())
  }

  const handleSave = (next: BibEntry) => {
    if (mode.kind === 'edit') {
      // Re-locate the entry in the CURRENT parse at save time: look up the live
      // range by citation key, never a range captured when the modal opened.
      // `entries` is derived from the current `value`, so its ranges are always
      // fresh. If the entry is gone (e.g. a collaborator deleted it), append
      // instead — never splice at a stale range.
      const current =
        entries.find(e => e.id === mode.entry.id) ??
        entries.find(e => e.key === mode.entry.key)
      if (current) {
        commit(replaceEntryInSource(value, current, serializeEntry(next)))
      } else {
        commit(appendEntriesToSource(value, [next]))
      }
    } else if (mode.kind === 'add') {
      commit(appendEntriesToSource(value, [next]))
    }
    setMode({ kind: 'idle' })
  }

  const handleImport = (chosen: BibEntry[]) => {
    commit(appendEntriesToSource(value, chosen))
    setMode({ kind: 'idle' })
  }

  // Undo/redo via keyboard, but never hijack native undo inside text inputs,
  // and never mutate the document while a modal is open (its captured entry
  // would go stale).
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (readOnly) return
    if (mode.kind !== 'idle') return
    const tag = (e.target as HTMLElement)?.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
    const mod = e.ctrlKey || e.metaKey
    if (!mod) return
    const key = e.key.toLowerCase()
    if (key === 'z') {
      e.preventDefault()
      if (e.shiftKey) redo()
      else undo()
    } else if (key === 'y') {
      e.preventDefault()
      redo()
    }
  }

  return (
    <div className="bibtex-visual-editor" onKeyDown={onKeyDown} tabIndex={-1}>
      <div className="bibtex-toolbar">
        <div className="ol-toolbar-layout-left">
          {!readOnly && (
            <div
              className="ol-editor-toolbar-button-group"
              aria-label={t('toolbar_undo_redo_actions')}
            >
              <BibtexToolbarButton
                id="toolbar-undo"
                label={t('toolbar_undo')}
                icon="undo"
                shortcut={isMac ? '⌘Z' : 'Ctrl+Z'}
                disabled={!canUndo}
                onClick={undo}
              />
              <BibtexToolbarButton
                id="toolbar-redo"
                label={t('toolbar_redo')}
                icon="redo"
                shortcut={isMac ? '⇧⌘Z' : 'Ctrl+Y'}
                disabled={!canRedo}
                onClick={redo}
              />
            </div>
          )}
        </div>
        <div className="ol-toolbar-layout-right">{toolbar}</div>
      </div>

      <div className="bibtex-entry-list-panel">
        {checkedIds.size === 0 ? (
          <>
            <div className="bibtex-entry-count">
              {filtered.length} {t('entry', { count: filtered.length })}
            </div>
            <OLFormControl
              className="bibtex-search"
              type="search"
              placeholder={`${t('search')} ${fileName ?? ''}`.trimEnd()}
              aria-label={t('search')}
              value={search}
              onChange={e => setSearch((e.target as HTMLInputElement).value)}
            />
            {!readOnly && (
              <Dropdown className="bibtex-add-button">
                <DropdownToggle
                  as={DropdownToggleCustom}
                  id="bibtex-add-toggle"
                  variant="secondary"
                >
                  <MaterialIcon type="add" /> Add
                </DropdownToggle>
                <DropdownMenu>
                  <li role="none">
                    <DropdownItem
                      description="BibTeX, DOI"
                      onClick={() => setMode({ kind: 'import' })}
                    >
                      Paste references
                    </DropdownItem>
                  </li>
                  <li role="none">
                    <DropdownItem onClick={() => setMode({ kind: 'add' })}>
                      Enter manually
                    </DropdownItem>
                  </li>
                </DropdownMenu>
              </Dropdown>
            )}
          </>
        ) : (
          <>
            <div className="bibtex-entry-count">
              {checkedIds.size}{' '}
              {t('selected_lowercase', { count: checkedIds.size })}
            </div>
            <OLButton
              onClick={handleDeleteSelected}
              variant="secondary"
              leadingIcon="delete"
              className="bibtex-delete-selected-btn"
            >
              {t('delete')}
            </OLButton>
          </>
        )}
      </div>

      {(mode.kind === 'add' || mode.kind === 'edit') && (
        <BibtexEntryModal
          show
          entry={mode.kind === 'edit' ? mode.entry : undefined}
          existingKeys={existingKeys}
          onSave={handleSave}
          onCancel={() => setMode({ kind: 'idle' })}
        />
      )}

      {mode.kind === 'import' && (
        <BibtexImportModal
          show
          existingKeys={existingKeys}
          onImport={handleImport}
          onCancel={() => setMode({ kind: 'idle' })}
          onResolveDoi={onResolveDoi}
        />
      )}

      <BibtexEntryTable
        entries={filtered}
        onEditEntry={
          readOnly ? undefined : entry => setMode({ kind: 'edit', entry })
        }
        onDeleteEntry={readOnly ? undefined : handleDelete}
        onCheckBoxChange={readOnly ? undefined : handleCheckBoxChange}
        onCheckAllChange={readOnly ? undefined : handleCheckAllChange}
        checkedEntries={checkedIds}
        searchTerms={searchTerms}
        hasDuplicateKey={entry => duplicateKeys.has(entry.key)}
        fileName={fileName}
      />
    </div>
  )
}
