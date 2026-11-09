import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  OLModal,
  OLModalBody,
  OLModalFooter,
  OLModalHeader,
  OLModalTitle,
} from '@/shared/components/ol/ol-modal'
import OLFormGroup from '@/shared/components/ol/ol-form-group'
import OLFormControl from '@/shared/components/ol/ol-form-control'
import OLButton from '@/shared/components/ol/ol-button'
import OLRow from '@/shared/components/ol/ol-row'
import OLCol from '@/shared/components/ol/ol-col'
import OLTag from '@/shared/components/ol/ol-tag'
import MaterialIcon from '@/shared/components/material-icon'
import { useReferencesContext } from '@/features/ide-react/context/references-context'
import { useTranslation } from 'react-i18next'
import type { Bib2JsonEntry } from '@/features/ide-react/references/types'

type FocusArea = 'search' | 'list' | 'footer'

type BadgeDrag = {
  key: string
  from: number | null
  source: 'row' | 'badge'
}

// Walk the flex items in visual order. The invisible badge occupies space
// but doesn't count towards the insertion index.
function insertionSlot(event: React.DragEvent<HTMLDivElement>) {
  const badges = Array.from(event.currentTarget.children) as HTMLElement[]
  badges.sort((a, b) => Number(a.style.order) - Number(b.style.order))

  let slot = 0
  let count = 0
  let nearestDistance = Infinity
  let rowCentre = 0

  for (const badge of badges) {
    const before = count
    if (!badge.hasAttribute('data-drag-source')) count++

    const rect = badge.getBoundingClientRect()
    const centre = rect.top + rect.height / 2
    const distance = Math.abs(event.clientY - centre)
    if (distance < nearestDistance) {
      nearestDistance = distance
      rowCentre = centre
      slot = before
    }
    if (centre === rowCentre && event.clientX >= rect.left + rect.width / 2) {
      slot = count
    }
  }
  return slot
}

function highlight(text: string, tokens: string[]) {
  if (!text || tokens.length === 0) return text

  const parts: React.ReactNode[] = [text]
  let globalIndex = 0

  tokens.forEach(token => {
    const next: React.ReactNode[] = []
    parts.forEach(part => {
      if (typeof part !== 'string') {
        next.push(part)
        return
      }

      const lower = part.toLowerCase()
      const t = token.toLowerCase()
      let start = 0
      let idx

      while ((idx = lower.indexOf(t, start)) !== -1) {
        if (idx > start) next.push(part.slice(start, idx))
        next.push(
          <span key={`${idx}-${token}-${globalIndex++}`} className="found-token">
            {part.slice(idx, idx + t.length)}
          </span>
        )
        start = idx + t.length
      }

      if (start < part.length) next.push(part.slice(start))
    })
    parts.splice(0, parts.length, ...next)
  })

  return parts
}

export default function ReferencePickerModal({
  show,
  onClose,
  onApply,
  initialKeys,
}: {
  show: boolean
  onClose: () => void
  onApply: (selectedKeys: string[]) => void
  initialKeys: string[]
}) {
  const { t } = useTranslation()
  const { searchLocalReferences } = useReferencesContext()

  const [query, setQuery] = useState('')
  const [selectedKeys, setSelectedKeys] = useState<string[]>(initialKeys)
  type Hit = { _source: Bib2JsonEntry }
  const [allResults, setAllResults] = useState<Hit[]>([])
  const [filteredResults, setFilteredResults] = useState<Hit[]>([])
  const search = query.trim()
  const results = search ? filteredResults : allResults
  const knownKeys = useMemo(
    () => new Set(allResults.map(hit => hit._source.EntryKey)),
    [allResults]
  )

  const [drag, setDrag] = useState<BadgeDrag | null>(null)
  const [dropTarget, setDropTarget] = useState<number | null>(null)

  function startDrag(event: React.DragEvent, drag: BadgeDrag) {
    const { key, from } = drag
    event.dataTransfer.effectAllowed = from === null ? 'copy' : 'move'
    event.dataTransfer.setData('application/x-reference-picker-key', key)
    setDrag(drag)
    setDropTarget(null)
  }

  function endDrag() {
    setDrag(null)
    setDropTarget(null)
  }

  function dropBadge(event: React.DragEvent<HTMLDivElement>) {
    if (!drag) return
    event.preventDefault()
    const to = dropTarget ?? insertionSlot(event)
    endDrag()
    if (drag.from === to) return

    setSelectedKeys(keys => {
      const next = [...keys]
      if (drag.from !== null) next.splice(drag.from, 1)
      next.splice(to, 0, drag.key)
      return next
    })
  }

  const tokens = useMemo(
    () => query.toLowerCase().trim().split(/\s+/).filter(Boolean),
    [query]
  )

  const searchFnRef = useRef(searchLocalReferences)
  useEffect(() => {
    searchFnRef.current = searchLocalReferences
  }, [searchLocalReferences])

  useEffect(() => {
    let active = true
    Promise.resolve(searchFnRef.current('')).then(response => {
      if (active) setAllResults(response.hits)
    })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!search) return

    let active = true
    Promise.resolve(searchFnRef.current(search)).then(response => {
      if (active) setFilteredResults(response.hits)
    })
    return () => { active = false }
  }, [search])

  const filteredKeys = results.map(r => r._source.EntryKey)

  const [focusArea, setFocusArea] = useState<FocusArea>('search')
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null)
  const saveButtonRef = useRef<HTMLButtonElement | null>(null)

const scrollToReference = useCallback((key: string) => {
  const index = results.findIndex(
    r => r._source.EntryKey === key
  )

  if (index === -1) return

  const el = document.getElementById(
    `reference-picker-item-${index}`
  )

  el?.scrollIntoView({
    behavior: 'smooth',
    block: 'nearest',
  })

  setFocusArea('list')
  setFocusedIndex(index)
}, [results])

  const removeOne = useCallback((key: string) => {
    setSelectedKeys(prev => {
      const index = prev.indexOf(key)
      if (index === -1) return prev
      return [...prev.slice(0, index), ...prev.slice(index + 1)]
    })
  }, [])

  const toggleKey = useCallback((key: string) => {
    setSelectedKeys(prev => {
      const index = prev.indexOf(key)
      if (index !== -1) {
        // remove one occurrence
        return [...prev.slice(0, index), ...prev.slice(index + 1)]
      }
      return [...prev, key]
    })
  }, [])

  const handleApply = useCallback(() => {
    onApply(selectedKeys)
    onClose()
  }, [selectedKeys, onApply, onClose])

  useEffect(() => {
    if (show) {
      setTimeout(() => searchRef.current?.focus(), 0)
      setFocusArea('search')
      setFocusedIndex(null)
    }
  }, [show])

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (focusArea === 'search') {
        if (event.key === 'ArrowDown') {
          event.preventDefault()
          setFocusArea('list')
          setFocusedIndex(0)
        }
      } else if (focusArea === 'list') {
        if (event.key === 'ArrowDown') {
          event.preventDefault()
          setFocusedIndex(prev =>
            prev == null ? 0 : Math.min(filteredKeys.length - 1, prev + 1)
          )
        } else if (event.key === 'ArrowUp') {
          event.preventDefault()
          setFocusedIndex(prev =>
            prev == null ? 0 : Math.max(0, prev - 1)
          )
        } else if (event.key === ' ') {
          event.preventDefault()
          if (focusedIndex !== null) {
            const k = filteredKeys[focusedIndex]
            if (k) toggleKey(k)
          }
        } else if (event.key === 'Enter') {
          event.preventDefault()
          handleApply()
        }
      }

      if (event.key === 'Tab') {
        const isShift = event.shiftKey
        event.preventDefault()
        event.stopPropagation()

        if (!isShift) {
          if (focusArea === 'search') {
            setFocusArea('list')
            setFocusedIndex(0)
            return
          }
          if (focusArea === 'list') {
            setFocusArea('footer')
            setFocusedIndex(null)
            cancelButtonRef.current?.focus()
            return
          }
          if (focusArea === 'footer') {
            if (document.activeElement === cancelButtonRef.current) {
              saveButtonRef.current?.focus()
              return
            } else {
              setFocusArea('search')
              setFocusedIndex(null)
              searchRef.current?.focus()
              return
            }
          }
        }

        if (isShift) {
          if (focusArea === 'search') {
            setFocusArea('footer')
            setFocusedIndex(null)
            saveButtonRef.current?.focus()
            return
          }
          if (focusArea === 'list') {
            setFocusArea('search')
            setFocusedIndex(null)
            searchRef.current?.focus()
            return
          }
          if (focusArea === 'footer') {
            if (document.activeElement === saveButtonRef.current) {
              cancelButtonRef.current?.focus()
              return
            } else {
              setFocusArea('list')
              setFocusedIndex(prev => prev ?? 0)
              return
            }
          }
        }
      }
    },
    [focusArea, filteredKeys, focusedIndex, toggleKey, handleApply]
  )

  useEffect(() => {
    if (focusArea === 'list' && focusedIndex !== null) {
      const el = document.getElementById(`reference-picker-item-${focusedIndex}`)
      if (el) el.focus()
    }
  }, [focusArea, focusedIndex])

  const previewKeys =
    drag && drag.from === null && dropTarget !== null
      ? [...selectedKeys, drag.key]
      : selectedKeys
  const sourceIndex = drag ? drag.from ?? selectedKeys.length : null

  return (
    <OLModal show={show} onHide={onClose} size="lg" themed>
      <OLModalHeader>
        <OLModalTitle>{t('references_picker_title')}</OLModalTitle>
      </OLModalHeader>
      <div onKeyDown={onKeyDown}>
        <OLModalBody className="references-search-modal">
          <div className="container-fluid">
            <OLRow>
              <OLFormGroup>
                <OLFormControl
                  name="search"
                  aria-label={t('search_references')}
                  type="search"
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder={t('search_references')}
                  prepend={<MaterialIcon type="search" />}
                  ref={searchRef}
                />
              </OLFormGroup>
            </OLRow>

            <OLRow>
              <div
                className="selected-key-tags"
                onDragOver={event => {
                  if (!drag) return
                  event.preventDefault()
                  event.dataTransfer.dropEffect = drag.from === null ? 'copy' : 'move'
                  setDropTarget(insertionSlot(event))
                }}
                onDragLeave={event => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                    setDropTarget(null)
                  }
                }}
                onDrop={dropBadge}
              >
                {previewKeys.map((key, idx) => (
                  <span
                    key={`${key}-${idx}`}
                    draggable={selectedKeys.length > 1}
                    onDragStart={event => startDrag(event, { key, from: idx, source: 'badge' })}
                    onDragEnd={endDrag}
                    data-drag-source={idx === sourceIndex ? drag?.source : undefined}
                    data-drop-slot={
                      (idx === sourceIndex && dropTarget !== null) || undefined
                    }
                    style={{
                      order:
                        idx === sourceIndex && dropTarget !== null
                          ? 2 * dropTarget + (dropTarget > idx ? 1 : -1)
                          : 2 * idx,
                    }}
                    className={
                      knownKeys.has(key)
                        ? 'existing-key-tag'
                        : 'nonexistent-key-tag'
                    }
                  >
                    <OLTag
                      contentProps={{ onClick: () => scrollToReference(key) }}
                      closeBtnProps={{ onClick: () => removeOne(key) }}
                    >
                      {key}
                    </OLTag>
                  </span>
                ))}
              </div>
            </OLRow>

            <OLRow className="search-results">
              <OLCol md={12} className="search-results-scroll-container">
                <ul className="list-unstyled">
                  {results.map((hit, index) => {
                    const key = hit._source.EntryKey
                    const { title = '', author = '', year = '', journal = '' } =
                      hit._source.Fields ?? {}

                    return (
                      <li
                        key={key}
                        id={`reference-picker-item-${index}`}
                        tabIndex={-1}
                        draggable
                        onDragStart={event => {
                          const index = selectedKeys.indexOf(key)
                          startDrag(event, {
                            key,
                            from: index === -1 ? null : index,
                            source: 'row',
                          })
                          const label = event.currentTarget.querySelector<HTMLElement>(
                            '.reference-result-key'
                          )
                          if (label) {
                            label.classList.add('drag-image')
                            event.dataTransfer.setDragImage(label, 8, label.offsetHeight / 2)
                          }
                        }}
                        onDragEnd={event => {
                          event.currentTarget.querySelector('.reference-result-key')
                            ?.classList.remove('drag-image')
                          endDrag()
                        }}
                        onClick={() => {
                          setFocusArea('list')
                          setFocusedIndex(index)
                          toggleKey(key)
                        }}
                        className={`search-result-hit ${
                          focusedIndex === index ? 'focused' : ''
                        } ${selectedKeys.includes(key) ? 'selected-search-result-hit' : ''}`}
                      >
                        <OLRow>
                          <OLCol md={12}>
                            <span className="hit-title">
                              {highlight(title, tokens)}
                            </span>
                            <span className="float-end reference-result-key">
                              {highlight(key, tokens)}
                            </span>
                          </OLCol>
                        </OLRow>

                        <OLRow>
                          <OLCol md={12}>
                            {[
                              highlight(author, tokens),
                              highlight(journal, tokens),
                              highlight(year, tokens),
                            ]
                              .filter(Boolean)
                              .reduce((acc, val, i) =>
                                i === 0 ? [val] : acc.concat('\u00A0—\u00A0', val),
                              [])}
                          </OLCol>
                        </OLRow>
                      </li>
                    )
                  })}
                </ul>
              </OLCol>
            </OLRow>
          </div>
        </OLModalBody>

        <OLModalFooter>
          <OLButton variant="secondary" onClick={onClose} ref={cancelButtonRef}>
            {t('cancel')}
          </OLButton>
          <OLButton variant="primary" onClick={handleApply} ref={saveButtonRef}>
            {t('apply')}
          </OLButton>
        </OLModalFooter>
      </div>
    </OLModal>
  )
}
