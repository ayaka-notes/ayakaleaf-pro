/**
 * The BibTeX entry table.
 *
 * - div-based grid with role="table"/"rowgroup"/"row"/"cell" and
 *   `.bibtex-entry-*` / `.bibtex-col-*` classes (the shipped CSS keys off these)
 * - columns: index (hidden), select (when onCheckBoxChange), errors, key,
 *   title, author, year, actions (when edit/delete callbacks exist)
 * - no sorting; the header "select" cell renders the select-all checkbox with
 *   an indeterminate state
 * - rows are always virtualized (react-virtual measureElement dynamic heights)
 *   with the `.bibtex-entry-list` element as the scroll container
 * - search terms highlight matching word prefixes with <mark>
 */
import React, { useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  Dropdown,
  DropdownToggle,
  DropdownMenu,
  DropdownItem,
} from '@/shared/components/dropdown/dropdown-menu'
import MaterialIcon from '@/shared/components/material-icon'
import OLButton from '@/shared/components/ol/ol-button'
import OLFormCheckbox from '@/shared/components/ol/ol-form-checkbox'
import OLTooltip from '@/shared/components/ol/ol-tooltip'
import { BibEntry } from '../bibtex/bibtex-entry'
import { getEntryTypeSchema } from '../bibtex/field-schema'

const EMPTY_CHECKED: Set<string> = new Set()

export interface BibtexEntryTableProps {
  entries: BibEntry[]
  onEditEntry?: (entry: BibEntry) => void
  onDeleteEntry?: (entry: BibEntry) => void
  onCheckBoxChange?: (entry: BibEntry) => void
  onCheckAllChange?: () => void
  checkedEntries?: Set<string>
  searchTerms?: string[]
  hasDuplicateKey?: (entry: BibEntry) => boolean
  fileName?: string
}

// --- search highlighting: word-prefix matcher ---

const WORD_RE = /[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N}'’-]*/gu

const segmenter =
  typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter()
    : null

function graphemes(text: string): string[] {
  return segmenter
    ? [...segmenter.segment(text)].map(s => s.segment)
    : [...text]
}

function normalize(text: string): string {
  return text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
}

// How many characters of `word` are covered by the longest term that is a
// prefix of the normalized word (0 = no match). Maps the normalized-prefix
// length back to a raw character count grapheme by grapheme.
function matchedPrefixLength(word: string, normTerms: string[]): number {
  const norm = normalize(word)
  if (!norm) return 0
  const matches = normTerms.filter(term => term && norm.startsWith(term))
  if (matches.length === 0) return 0
  const normLengths: number[] = []
  const rawLengths: number[] = []
  let normLen = 0
  let rawLen = 0
  for (const g of graphemes(word)) {
    normLen += normalize(g).length
    rawLen += g.length
    normLengths.push(normLen)
    rawLengths.push(rawLen)
  }
  return Math.max(
    0,
    ...matches.map(term => {
      const i = normLengths.findIndex(len => len >= term.length)
      return i === -1 ? 0 : rawLengths[i]
    })
  )
}

function HighlightedText({
  text,
  terms = [],
}: {
  text: string
  terms?: string[]
}) {
  const normTerms = useMemo(
    () => terms.map(normalize).filter(Boolean),
    [terms]
  )
  if (normTerms.length === 0) {
    return <>{text}</>
  }
  const parts: React.ReactNode[] = []
  let last = 0
  for (const match of text.matchAll(WORD_RE)) {
    const word = match[0]
    const at = match.index!
    if (at > last) {
      parts.push(text.slice(last, at))
    }
    const len = matchedPrefixLength(word, normTerms)
    if (len > 0) {
      parts.push(<mark key={at}>{word.slice(0, len)}</mark>)
      if (len < word.length) {
        parts.push(word.slice(len))
      }
    } else {
      parts.push(word)
    }
    last = at + word.length
  }
  if (last < text.length) {
    parts.push(text.slice(last))
  }
  return <>{parts}</>
}

// --- entry error indicator (warning tooltip) ---

// A required group is missing when NONE of its members is present
// (`hasField` — presence, not a non-empty value).
function missingRequiredFieldGroups(entry: BibEntry): string[][] {
  const schema = getEntryTypeSchema(entry.type)
  if (!schema) return []
  const missing: string[][] = []
  for (const spec of schema.requiredFields) {
    const group = typeof spec === 'string' ? [spec] : spec
    if (!group.some(field => entry.hasField(field))) {
      missing.push(group)
    }
  }
  return missing
}

function EntryErrorIndicator({
  entry,
  hasDuplicateKey,
  fileName,
}: {
  entry: BibEntry
  hasDuplicateKey: boolean
  fileName?: string
}) {
  const { t } = useTranslation()
  const missing = useMemo(() => missingRequiredFieldGroups(entry), [entry])

  if (!hasDuplicateKey && missing.length === 0) {
    return null
  }

  const description = (
    <div className="bibtex-tooltip-errors">
      {hasDuplicateKey && fileName ? (
        <div>{t('bibtex_duplicates_keys', { key: entry.key, fileName })}</div>
      ) : null}
      {missing.length > 0 ? (
        <div>
          <div>
            {missing.length === 1
              ? t('missing_field_for_entry')
              : t('missing_fields_for_entry')}{' '}
            {entry.type}:
          </div>
          <ul>
            {missing.map(group => {
              const label = group.join(` ${t('or')} `)
              return <li key={label}>{label}</li>
            })}
          </ul>
        </div>
      ) : null}
    </div>
  )

  return (
    <OLTooltip
      id={`bibtex-entry-errors-${entry.id}`}
      description={description}
      overlayProps={{ placement: 'right' }}
    >
      <button
        type="button"
        className="bibtex-entry-error-icon"
        aria-label={t('entry_has_errors')}
      >
        <MaterialIcon type="error" unfilled />
      </button>
    </OLTooltip>
  )
}

// --- the table ---

const columnHelper = createColumnHelper<BibEntry>()

export function BibtexEntryTable({
  entries,
  onEditEntry,
  onDeleteEntry,
  onCheckBoxChange,
  onCheckAllChange,
  checkedEntries = EMPTY_CHECKED,
  searchTerms,
  hasDuplicateKey,
  fileName,
}: BibtexEntryTableProps) {
  const { t } = useTranslation()
  const listRef = useRef<HTMLDivElement>(null)
  const selectAllRef = useRef<HTMLInputElement | null>(null)

  const columns = useMemo(
    () =>
      [
        columnHelper.accessor((_entry, index) => index, {
          id: 'index',
          header: '#',
          cell: info => info.getValue() + 1,
        }),
        onCheckBoxChange
          ? columnHelper.display({
              id: 'select',
              enableSorting: false,
              header: () => null,
              cell: ({ row }) => (
                <OLFormCheckbox
                  autoComplete="off"
                  onClick={(e: React.MouseEvent) => e.stopPropagation()}
                  onChange={() => onCheckBoxChange(row.original)}
                  checked={checkedEntries.has(row.original.id)}
                  aria-label={t('select_entry')}
                />
              ),
            })
          : null,
        columnHelper.display({
          id: 'errors',
          enableSorting: false,
          header: () => null,
          cell: ({ row }) => (
            <EntryErrorIndicator
              entry={row.original}
              hasDuplicateKey={hasDuplicateKey?.(row.original) ?? false}
              fileName={fileName}
            />
          ),
        }),
        columnHelper.accessor(e => e.key, {
          id: 'key',
          header: 'Citation key',
          cell: info => (
            <span className="citation-key">
              <HighlightedText text={info.getValue()} terms={searchTerms} />
            </span>
          ),
        }),
        columnHelper.accessor(e => e.getTitle(), {
          id: 'title',
          header: 'Title',
          cell: info => (
            <HighlightedText text={info.getValue()} terms={searchTerms} />
          ),
        }),
        columnHelper.accessor(e => e.getAuthors().join(), {
          id: 'author',
          header: 'Author',
          cell: info => (
            <HighlightedText text={info.getValue()} terms={searchTerms} />
          ),
        }),
        columnHelper.accessor(e => e.getYear(), {
          id: 'year',
          header: 'Year',
          cell: info => (
            <HighlightedText text={info.getValue()} terms={searchTerms} />
          ),
        }),
        onEditEntry || onDeleteEntry
          ? columnHelper.display({
              id: 'actions',
              enableSorting: false,
              header: () => null,
              cell: ({ row }) => (
                <Dropdown>
                  <DropdownToggle
                    id={`bibtex-entry-actions-${row.original.id}`}
                    as={OLButton}
                    variant="ghost"
                    size="sm"
                    className="custom-toggle"
                    aria-label={t('actions')}
                  >
                    <MaterialIcon type="more_vert" />
                  </DropdownToggle>
                  <DropdownMenu>
                    {onEditEntry && (
                      <li role="none">
                        <DropdownItem
                          leadingIcon="edit"
                          onClick={() => onEditEntry(row.original)}
                        >
                          {t('edit')}
                        </DropdownItem>
                      </li>
                    )}
                    {onDeleteEntry && (
                      <li role="none">
                        <DropdownItem
                          leadingIcon="delete"
                          onClick={() => onDeleteEntry(row.original)}
                        >
                          {t('delete')}
                        </DropdownItem>
                      </li>
                    )}
                  </DropdownMenu>
                </Dropdown>
              ),
            })
          : null,
      ].filter(column => column !== null),
    [
      onCheckBoxChange,
      onEditEntry,
      onDeleteEntry,
      checkedEntries,
      searchTerms,
      hasDuplicateKey,
      fileName,
      t,
    ]
  )

  const table = useReactTable({
    data: entries,
    columns,
    initialState: {
      columnVisibility: {
        index: false,
      },
    },
    getCoreRowModel: getCoreRowModel(),
  })

  const { rows } = table.getRowModel()

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => 37,
    overscan: 10,
    getItemKey: index => rows[index].original.id,
  })

  const virtualItems = virtualizer.getVirtualItems()

  // keep the select-all checkbox's indeterminate state in sync
  useEffect(() => {
    if (selectAllRef.current) {
      const some = rows.some(row => checkedEntries.has(row.original.id))
      const all =
        rows.length > 0 &&
        rows.every(row => checkedEntries.has(row.original.id))
      selectAllRef.current.indeterminate = some && !all
    }
  }, [checkedEntries, rows])

  return (
    <div className="bibtex-entry-list" ref={listRef} role="table">
      <div role="rowgroup" className="bibtex-entry-header">
        {table.getHeaderGroups().map(headerGroup => (
          <div className="bibtex-entry-row" role="row" key={headerGroup.id}>
            {headerGroup.headers.map(header => (
              <div
                className={`bibtex-entry-cell bibtex-entry-header-cell bibtex-col-${header.column.id}`}
                role="columnheader"
                key={header.id}
              >
                {header.column.id === 'select' ? (
                  <OLFormCheckbox
                    autoComplete="off"
                    onChange={onCheckAllChange}
                    onClick={(e: React.MouseEvent) => e.stopPropagation()}
                    checked={
                      rows.length > 0 &&
                      rows.every(row => checkedEntries.has(row.original.id))
                    }
                    disabled={entries.length === 0}
                    aria-label={t('select_all_entries')}
                    inputRef={selectAllRef}
                  />
                ) : (
                  flexRender(
                    header.column.columnDef.header,
                    header.getContext()
                  )
                )}
              </div>
            ))}
          </div>
        ))}
      </div>
      <div
        className="bibtex-entry-list-body-container"
        style={{ height: `${virtualizer.getTotalSize()}px` }}
        role="rowgroup"
      >
        <div
          className="bibtex-entry-list-body"
          style={{
            transform: `translateY(${virtualItems[0]?.start ?? 0}px)`,
          }}
        >
          {virtualItems.map(virtualItem => {
            const row = rows[virtualItem.index]
            return (
              <div
                data-index={virtualItem.index}
                ref={virtualizer.measureElement}
                className="bibtex-entry-row bibtex-entry-data-row"
                role="row"
                key={virtualItem.key}
              >
                {row.getVisibleCells().map(cell => (
                  <div
                    className={`bibtex-entry-cell bibtex-col-${cell.column.id}`}
                    role="cell"
                    key={cell.id}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
