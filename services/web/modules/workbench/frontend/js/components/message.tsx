/**
 * Provides message containers styled by the sender's role.
 */
import type { HTMLAttributes } from 'react'
import classNames from 'classnames'

export const Message = ({
  className,
  from,
  ...props
}: HTMLAttributes<HTMLDivElement> & { from: string }) => (
  <div
    className={classNames(
      className,
      'workbench-message',
      from === 'user' ? 'from-user' : 'from-assistant'
    )}
    {...props}
  />
)

export const MessageContent = ({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) => (
  <div className={classNames('workbench-message-content', className)} {...props} />
)
