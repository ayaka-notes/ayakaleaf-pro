/**
 * One tool call in the conversation: what it does, where it stands, and the
 * tool's own content (an edit to review, a rendered page, the sources found).
 */
import { useState, type ReactNode } from 'react'
import MaterialIcon from '@/shared/components/material-icon'
import SourceLinks, { type Link } from './source-links'
import { faint, muted } from './themed'

function StateMark({ state }: { state: string }) {
  switch (state) {
    case 'output-available':
      return <MaterialIcon type="check" style={{ color: 'var(--content-positive-themed)' }} accessibilityLabel="Done" />
    case 'output-error':
    case 'output-denied':
      return <MaterialIcon type="close" style={{ color: 'var(--content-danger-themed)' }} accessibilityLabel="Failed" />
    case 'input-available':
      return <MaterialIcon type="schedule" style={muted} accessibilityLabel="Waiting" />
    default:
      return (
        <span
          className="spinner-border spinner-border-sm"
          style={muted}
          role="status"
          aria-label="Running"
        />
      )
  }
}

export default function ToolCard({
  name,
  state,
  label,
  errorText,
  links,
  children,
}: {
  name: string
  state: string
  label: string
  errorText?: string
  links?: Link[]
  children?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  // One line a call: a long label, such as a URL, is cut short
  const header = (
    <>
      <StateMark state={state} />
      <span className="text-truncate" title={label}>
        {label}
      </span>
    </>
  )
  return (
    <div style={{ fontSize: 'var(--font-size-01)' }}>
      <div className="d-flex align-items-center gap-1" style={faint} data-tool-call={name}>
        {links?.length ? (
          // The whole row opens the results; the count and arrow sit at its end
          <button
            type="button"
            className="btn btn-link btn-sm p-0 flex-grow-1 text-start text-reset text-decoration-none d-flex align-items-center gap-1"
            // A long query is cut short rather than pushing the count out
            style={{ fontSize: 'inherit', minWidth: 0 }}
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            {header}
            <span className="ms-auto flex-shrink-0 d-flex align-items-center">
              {links.length === 1 ? '1 result' : `${links.length} results`}
              <MaterialIcon type={open ? 'keyboard_arrow_down' : 'keyboard_arrow_right'} />
            </span>
          </button>
        ) : (
          header
        )}
      </div>
      {open && links?.length ? <SourceLinks links={links} /> : null}
      {state === 'output-error' && errorText && (
        <div className="ms-4" style={muted}>
          {errorText}
        </div>
      )}
      {children}
    </div>
  )
}
