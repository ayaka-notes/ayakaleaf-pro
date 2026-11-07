import '../../stylesheets/reference-picker.scss'
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
  const [selectedKeys, setSelectedKeys] = useState<string[]>([])
  const [results, setResults] = useState<{ _source: Bib2JsonEntry }[]>([])

  const pendingInitialKeysRef = useRef<string[]>([])
  const requestIdRef = useRef(0)
  const searchFnRef = useRef(searchLocalReferences)

  useEffect(() => {
    searchFnRef.current = searchLocalReferences
  }, [searchLocalReferences])

  const tokens = useMemo(
    () => query.toLowerCase().trim().split(/\s+/).filter(Boolean),
    [query]
  )

  useEffect(() => {
    if (!show) return

    requestIdRef.current++

    setQuery('')
    setSelectedKeys([])
    setResults([])

    pendingInitialKeysRef.current = [...initialKeys]

    const requestId = ++requestIdRef.current

    const perform = async () => {
      const r = await searchFnRef.current('')

      if (requestId !== requestIdRef.current) return

      setResults(r.hits)

      if (pendingInitialKeysRef.current.length > 0) {
        // Preserve every existing key, even ones the local index can't resolve
        // (stale/oversized .bib, unresolved refs); otherwise Replace silently drops them.
        setSelectedKeys(pendingInitialKeysRef.current)
        pendingInitialKeysRef.current = []
      }
    }

    perform()
  }, [show, initialKeys])

  useEffect(() => {
    if (!show) return

    const requestId = ++requestIdRef.current

    const perform = async () => {
      const r = await searchFnRef.current(query.trim() || '')

      if (requestId !== requestIdRef.current) return

      setResults(r.hits)
    }

    perform()
  }, [query])

  const filteredKeys = results.map(r => r._source.EntryKey)

  const [focusArea, setFocusArea] = useState<FocusArea>('search')
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)
  const cancelButtonRef = useRef<HTMLButtonElement | null>(null)
  const insertButtonRef = useRef<HTMLButtonElement | null>(null)

  const removeOne = useCallback((key: string) => {
    setSelectedKeys(prev => {
      const index = prev.indexOf(key)
      if (index === -1) return prev
      return [...prev.slice(0, index), ...prev.slice(index + 1)]
    })
  }, [])

  const addOne = useCallback((key: string) => {
    setSelectedKeys(prev => [...prev, key])
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
              insertButtonRef.current?.focus()
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
            insertButtonRef.current?.focus()
            return
          }
          if (focusArea === 'list') {
            setFocusArea('search')
            setFocusedIndex(null)
            searchRef.current?.focus()
            return
          }
          if (focusArea === 'footer') {
            if (document.activeElement === insertButtonRef.current) {
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

  return (
    <OLModal show={show} onHide={onClose} size="lg">
      <OLModalHeader>
        <OLModalTitle>{t('search_references')}</OLModalTitle>
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
              <div className="selected-key-tag">
                {selectedKeys.map((key, idx) => (
                  <OLTag
                    key={`${key}-${idx}`}
                    closeBtnProps={{ onClick: () => removeOne(key) }}
                  >
                    {key}
                  </OLTag>
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
                            <span className="float-end">
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
          <OLButton variant="primary" onClick={handleApply} ref={insertButtonRef}>
            {initialKeys.length ? t('search_replace') : t('insert')}
          </OLButton>
        </OLModalFooter>
      </div>
    </OLModal>
  )
}
