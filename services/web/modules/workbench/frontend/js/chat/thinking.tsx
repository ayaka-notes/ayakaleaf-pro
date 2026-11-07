/**
 * The model's reasoning, folded under a line that says how long it took.
 */
import { useEffect, useRef, useState } from 'react'
import MaterialIcon from '@/shared/components/material-icon'
import Markdown from './markdown'
import { faint } from './themed'

export default function Thinking({ text, active }: { text: string; active: boolean }) {
  const [open, setOpen] = useState(false)
  const startedAt = useRef<number | null>(null)
  const [seconds, setSeconds] = useState(0)

  useEffect(() => {
    if (active) {
      startedAt.current ??= Date.now()
    } else if (startedAt.current !== null) {
      setSeconds(Math.max(1, Math.round((Date.now() - startedAt.current) / 1000)))
      startedAt.current = null
    }
  }, [active])

  return (
    <div style={{ ...faint, fontSize: 'var(--font-size-01)' }}>
      <button
        type="button"
        className="btn btn-link btn-sm p-0 text-reset text-decoration-none d-inline-flex align-items-center gap-1"
        style={{ fontSize: 'inherit' }}
        aria-expanded={open}
        disabled={!text}
        onClick={() => setOpen(!open)}
      >
        <MaterialIcon type="psychology" />
        {active ? 'Reasoning…' : seconds ? `Reasoned for ${seconds} s` : 'Reasoning'}
        {text && <MaterialIcon type={open ? 'keyboard_arrow_down' : 'keyboard_arrow_right'} />}
      </button>
      {open && (
        <div className="ps-2 mt-1" style={{ borderLeft: '2px solid var(--border-divider-themed)' }}>
          <Markdown text={text} />
        </div>
      )}
    </div>
  )
}
