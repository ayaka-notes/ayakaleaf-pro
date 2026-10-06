/**
 * Displays collapsible source links returned by web and documentation searches.
 */
import { useCallback, useState, type FC, type PropsWithChildren } from 'react'
import { Collapse } from 'react-bootstrap'
import MaterialIcon from '@/shared/components/material-icon'

export const CollapsibleSources: FC<PropsWithChildren<{ count: number }>> = ({
  count,
  children,
}) => {
  const [expanded, setExpanded] = useState(false)
  const toggle = useCallback(() => {
    setExpanded(expanded => !expanded)
  }, [])
  return (
    <div className="mb-2 small" style={{ fontSize: '0.8rem' }}>
      <button
        onClick={toggle}
        aria-expanded={expanded}
        className="my-1 reasoning-toggle d-flex reasoning-label-text"
      >
        <span>Used {count} sources</span>
        <MaterialIcon
          type="expand_more"
          style={{
            transform: expanded ? 'rotate(0deg)' : 'rotate(-90deg)',
            transition: 'transform 0.2s ease',
          }}
        />
      </button>
      <Collapse in={expanded}>
        <div>
          <div className="d-flex flex-column gap-1 w-auto">{children}</div>
        </div>
      </Collapse>
    </div>
  )
}

export const SourceLink = ({ href, title }: { href?: string; title?: string }) => (
  <a className="d-flex text-decoration-none" href={href} rel="noreferrer" target="_blank">
    <span>{title}</span>
  </a>
)
