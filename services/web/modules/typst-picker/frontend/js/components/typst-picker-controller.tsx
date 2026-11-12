import { useCallback, useEffect, useRef, useState } from 'react'
import { useEditorViewContext } from '../../../../../frontend/js/features/ide-react/context/editor-view-context'
import { useReferencesContext } from '../../../../../frontend/js/features/ide-react/context/references-context'

/**
 * Typst reference picker controller.
 * Independent from the LaTeX reference picker.
 * Always inserts @key @key @key (Typst 0.15.x @ syntax works for all keys).
 */
export default function TypstPickerController() {
  const { view } = useEditorViewContext()
  const { searchLocalReferences } = useReferencesContext()

  const [open, setOpen] = useState(false)
  const [from, setFrom] = useState<number | null>(null)
  const [to, setTo] = useState<number | null>(null)
  const [initialKeys, setInitialKeys] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [selectedKeys, setSelectedKeys] = useState<string[]>([])
  const [results, setResults] = useState<{ EntryKey: string; Fields: Record<string, unknown> }[]>([])
  const [focusedIndex, setFocusedIndex] = useState(0)

  const justAppliedRef = useRef(false)
  const searchInputRef = useRef<HTMLInputElement | null>(null)

  // Search references
  const performSearch = useCallback(async (q: string) => {
    if (!searchLocalReferences) return
    try {
      const r = await searchLocalReferences(q)
      setResults((r.hits || []).map((h: any) => h._source || h))
    } catch {
      setResults([])
    }
  }, [searchLocalReferences])

  // Listen for the picker event
  useEffect(() => {
    const handler = (evt: CustomEvent) => {
      if (justAppliedRef.current) {
        justAppliedRef.current = false
        return
      }
      const detail = evt.detail || {}
      setFrom(detail.insertFrom ?? detail.from ?? 0)
      setTo(detail.insertTo ?? detail.to ?? 0)
      setInitialKeys(detail.selectedKeys || [])
      setSelectedKeys(detail.selectedKeys || [])
      setQuery('')
      setFocusedIndex(0)
      setOpen(true)
      // Initial search
      performSearch('')
    }
    window.addEventListener('typst:openPicker', handler as EventListener)
    return () => window.removeEventListener('typst:openPicker', handler as EventListener)
  }, [performSearch])

  // Focus search input when opened
  useEffect(() => {
    if (open) {
      setTimeout(() => searchInputRef.current?.focus(), 50)
    }
  }, [open])

  const onClose = useCallback(() => setOpen(false), [])

  const onApply = useCallback(() => {
    if (!view || from == null || to == null) return
    if (selectedKeys.length === 0) return

    const doc = view.state.doc
    // Always use @key syntax (works for all keys in Typst 0.15.x)
    const insert = selectedKeys.map((k) => `@${k}`).join(' ')

    // Expand over spaces around selection
    let start = from
    let end = to
    while (start > 0 && /[ \t]/.test(doc.sliceString(start - 1, start))) start--
    while (end < doc.length && /[ \t]/.test(doc.sliceString(end, end + 1))) end++

    // Add space if needed
    let prefix = ''
    let suffix = ''
    if (start > 0 && doc.sliceString(start - 1, start) !== ' ' && doc.sliceString(start - 1, start) !== '\n') prefix = ' '
    if (end < doc.length && doc.sliceString(end, end + 1) !== ' ' && doc.sliceString(end, end + 1) !== '\n' && doc.sliceString(end, end + 1) !== '') suffix = ' '

    view.dispatch({
      changes: { from: start, to: end, insert: prefix + insert + suffix },
      selection: { anchor: start + prefix.length + insert.length + (suffix ? 1 : 0) },
    })
    view.focus()
    justAppliedRef.current = true
    setOpen(false)
  }, [view, from, to, selectedKeys])

  const toggleKey = useCallback((key: string) => {
    setSelectedKeys((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    )
  }, [])

  // Keyboard navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setFocusedIndex((i) => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setFocusedIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && focusedIndex >= 0 && focusedIndex < results.length) {
      e.preventDefault()
      toggleKey(results[focusedIndex].EntryKey)
    } else if (e.key === 'Escape') {
      onClose()
    }
  }, [results, focusedIndex, toggleKey, onClose])

  if (!open) return null

  return (
    <div className="modal fade show" style={{ display: 'block', backgroundColor: 'rgba(0,0,0,0.5)' }} role="dialog">
      <div className="modal-dialog" role="document">
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">Insert Citation</h5>
            <button type="button" className="close" onClick={onClose} aria-label="Close">
              <span aria-hidden="true">&times;</span>
            </button>
          </div>
          <div className="modal-body">
            <input
              ref={searchInputRef}
              type="text"
              className="form-control mb-3"
              placeholder="Search citations..."
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setFocusedIndex(0)
                performSearch(e.target.value)
              }}
              onKeyDown={handleKeyDown}
            />
            <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
              {results.map((r, i) => (
                <div
                  key={r.EntryKey}
                  className={`list-group-item list-group-item-action ${i === focusedIndex ? 'active' : ''} ${selectedKeys.includes(r.EntryKey) ? 'bg-success' : ''}`}
                  onClick={() => toggleKey(r.EntryKey)}
                  style={{ cursor: 'pointer' }}
                >
                  <strong>{r.EntryKey}</strong>
                  {r.Fields?.title && <span className="d-block small text-muted">{String(r.Fields.title).slice(0, 80)}</span>}
                  {r.Fields?.author && <span className="d-block small text-muted">{String(r.Fields.author).slice(0, 60)}</span>}
                </div>
              ))}
              {results.length === 0 && <div className="text-muted p-2">No citations found</div>}
            </div>
            {selectedKeys.length > 0 && (
              <div className="mt-2 small text-muted">
                Selected: {selectedKeys.map((k) => `@${k}`).join(' ')}
              </div>
            )}
          </div>
          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
            <button type="button" className="btn btn-primary" onClick={onApply} disabled={selectedKeys.length === 0}>
              Insert ({selectedKeys.length})
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
