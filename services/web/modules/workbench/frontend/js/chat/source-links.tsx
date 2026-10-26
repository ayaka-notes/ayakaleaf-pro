/**
 * The pages a search tool returned, folded behind a count until opened.
 */
import { useState } from 'react'
import MaterialIcon from '@/shared/components/material-icon'
import { link as linkColor } from './themed'

type Link = { href?: string; text?: string }

export default function SourceLinks({ links }: { links: Link[] }) {
  const [open, setOpen] = useState(false)
  if (links.length === 0) return null
  return (
    <div style={{ fontSize: 'var(--font-size-01)' }}>
      <button
        type="button"
        className="btn btn-link btn-sm p-0 text-reset text-decoration-none d-inline-flex align-items-center"
        style={{ fontSize: 'inherit' }}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {links.length === 1 ? '1 source' : `${links.length} sources`}
        <MaterialIcon type={open ? 'keyboard_arrow_down' : 'keyboard_arrow_right'} />
      </button>
      {open && (
        <ul className="list-unstyled mb-0 ps-2 d-flex flex-column gap-1">
          {links.map(link => (
            <li key={link.href}>
              <a href={link.href} style={linkColor} target="_blank" rel="noreferrer">
                {link.text}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
