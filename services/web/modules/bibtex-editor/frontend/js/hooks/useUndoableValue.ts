/**
 * Operation-level undo/redo over a controlled string `value`.
 *
 * Every editor mutation goes through `commit(next)` (which also calls the host
 * `onChange`, so it flows into your document/OT layer as usual). `undo`/`redo`
 * replay previous/next snapshots through the same `onChange`.
 *
 * If `value` changes externally (e.g. edited in the code view / remote OT),
 * the history is reset to that new baseline so undo never produces a
 * surprising state.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

export interface Undoable {
  commit: (next: string) => void
  undo: () => void
  redo: () => void
  canUndo: boolean
  canRedo: boolean
}

export function useUndoableValue(
  value: string,
  onChange: (next: string) => void
): Undoable {
  const [past, setPast] = useState<string[]>([])
  const [future, setFuture] = useState<string[]>([])
  // the value we last pushed through onChange ourselves
  const owned = useRef(value)

  // Detect external changes (not caused by our commit/undo/redo) and reset.
  useEffect(() => {
    if (value !== owned.current) {
      owned.current = value
      setPast([])
      setFuture([])
    }
  }, [value])

  const commit = useCallback(
    (next: string) => {
      const prev = owned.current // capture BEFORE mutating the ref
      if (next === prev) return
      owned.current = next
      setPast(p => [...p, prev]) // updater closes over the captured const, not the ref
      setFuture([])
      onChange(next)
    },
    [onChange]
  )

  const undo = useCallback(() => {
    if (past.length === 0) return
    const cur = owned.current
    const prev = past[past.length - 1]
    owned.current = prev
    setPast(past.slice(0, -1))
    setFuture([cur, ...future])
    onChange(prev)
  }, [past, future, onChange])

  const redo = useCallback(() => {
    if (future.length === 0) return
    const cur = owned.current
    const next = future[0]
    owned.current = next
    setFuture(future.slice(1))
    setPast([...past, cur])
    onChange(next)
  }, [past, future, onChange])

  return { commit, undo, redo, canUndo: past.length > 0, canRedo: future.length > 0 }
}
