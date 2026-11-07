import { ReactNode } from 'react'

export default function DropdownListItem({
  className,
  children,
}: {
  className?: string
  children: ReactNode
}) {
  return (
    <li role="none" className={className}>
      {children}
    </li>
  )
}
