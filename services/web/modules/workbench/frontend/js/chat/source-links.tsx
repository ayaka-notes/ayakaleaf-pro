/**
 * The pages a search tool returned, one link a row, shown when its tool card
 * is opened.
 */
import { boxed, faint, muted, plain, ruleAbove } from './themed'

export type Link = { href?: string; text?: string }

const domainOf = (href?: string) => (href ? new URL(href).hostname.replace(/^www\./, '') : '')

export default function SourceLinks({ links }: { links: Link[] }) {
  return (
    <div className="rounded overflow-hidden mt-1 mb-1" style={boxed}>
      <div className="px-2 py-1" style={muted}>
        Results
      </div>
      {links.map(link => (
        <a
          className="d-flex align-items-center gap-2 px-2 py-1 text-decoration-none"
          style={ruleAbove}
          href={link.href}
          target="_blank"
          rel="noreferrer"
          key={link.href}
        >
          <span className="text-truncate" style={plain}>
            {link.text}
          </span>
          <span className="ms-auto flex-shrink-0" style={faint}>
            {domainOf(link.href)}
          </span>
        </a>
      ))}
    </div>
  )
}
