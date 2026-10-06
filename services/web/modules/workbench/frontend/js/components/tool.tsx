/**
 * Displays tool-call progress, approval state, and results in a collapsible panel.
 */
import {
  createContext,
  useCallback,
  useContext,
  useId,
  useState,
  type FC,
  type PropsWithChildren,
  type ReactNode,
} from 'react'
import classNames from 'classnames'
import { Collapse } from 'react-bootstrap'
import MaterialIcon from '@/shared/components/material-icon'
import OLTooltip from '@/shared/components/ol/ol-tooltip'

const ToolContext = createContext<{ open: boolean; toggle: () => void } | null>(
  null
)

const useToolContext = () => {
  const context = useContext(ToolContext)
  if (!context) {
    throw new Error('Tool subcomponents must be used within <Tool>.')
  }
  return context
}

export const Tool: FC<
  PropsWithChildren<{ className?: string; defaultOpen?: boolean }>
> = ({ className, children, defaultOpen }) => {
  const [open, setOpen] = useState(!!defaultOpen)
  const toggle = useCallback(() => setOpen(open => !open), [])
  return (
    <ToolContext.Provider value={{ open, toggle }}>
      <div
        className={classNames('tool-use rounded w-100', className)}
        data-open={open || undefined}
      >
        {children}
      </div>
    </ToolContext.Provider>
  )
}

export type ToolState =
  | 'input-streaming'
  | 'input-available'
  | 'approval-requested'
  | 'approval-responded'
  | 'output-available'
  | 'output-error'
  | 'output-denied'

const stateLabels: Record<ToolState, string> = {
  'input-streaming': 'Pending',
  'input-available': 'Running',
  'approval-requested': 'Awaiting Approval',
  'approval-responded': 'Responded',
  'output-available': 'Completed',
  'output-error': 'Error',
  'output-denied': 'Denied',
}

const stateIcons: Record<ToolState, ReactNode> = {
  'input-streaming': (
    <MaterialIcon type="hourglass_empty" className="workbench-tool-input-streaming" />
  ),
  'input-available': <MaterialIcon type="schedule" className="text-warning" />,
  'approval-requested': <MaterialIcon type="schedule" className="text-warning" />,
  'approval-responded': <MaterialIcon type="done" className="text-primary" />,
  'output-available': <MaterialIcon type="check_circle" className="text-success" />,
  'output-error': <MaterialIcon type="error" className="text-danger" />,
  'output-denied': <MaterialIcon type="block" className="text-warning" />,
}

export const ToolHeader = ({
  className,
  title,
  type,
  state,
  ...props
}: {
  className?: string
  title?: ReactNode
  type: string
  state: ToolState
}) => {
  const { open, toggle } = useToolContext()
  const tooltipId = useId()
  return (
    <button
      type="button"
      onClick={toggle}
      aria-expanded={open}
      className={classNames(
        'd-flex w-100 align-items-center p-0 bg-transparent border-0 text-start small',
        'tool-header',
        className
      )}
      {...props}
    >
      <div className="d-flex align-items-center">
        <OLTooltip id={tooltipId} description={stateLabels[state]}>
          <span className="me-1 d-flex align-items-center">{stateIcons[state]}</span>
        </OLTooltip>
        <span>{title ?? type.split('-').slice(1).join('-')}</span>
      </div>
    </button>
  )
}

export const ToolContent: FC<PropsWithChildren<{ className?: string }>> = ({
  className,
  children,
}) => {
  const { open } = useToolContext()
  return (
    <Collapse in={open}>
      <div className={classNames('tool-content', className)}>{children}</div>
    </Collapse>
  )
}
