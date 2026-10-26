/**
 * One tool call in the conversation: what it does, where it stands, and the
 * tool's own content (an edit to review, a rendered page, the sources found).
 */
import type { ReactNode } from 'react'
import MaterialIcon from '@/shared/components/material-icon'
import { faint, muted } from './themed'

function StateMark({ state }: { state: string }) {
  switch (state) {
    case 'output-available':
      return <MaterialIcon type="check" style={{ color: 'var(--content-positive-themed)' }} accessibilityLabel="Done" />
    case 'output-error':
    case 'output-denied':
      return <MaterialIcon type="close" style={{ color: 'var(--content-danger-themed)' }} accessibilityLabel="Failed" />
    case 'input-available':
      return <MaterialIcon type="pending" style={muted} accessibilityLabel="Waiting" />
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
  children,
}: {
  name: string
  state: string
  label: string
  errorText?: string
  children?: ReactNode
}) {
  return (
    <div style={{ fontSize: 'var(--font-size-01)' }}>
      <div className="d-flex align-items-center gap-1" style={faint} data-tool-call={name}>
        <StateMark state={state} />
        <span>{label}</span>
      </div>
      {state === 'output-error' && errorText && (
        <div className="ms-4" style={muted}>
          {errorText}
        </div>
      )}
      {children}
    </div>
  )
}
