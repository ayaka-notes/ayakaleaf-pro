import { User } from '../../../../../../types/user/api'

type EmailCellProps = {
  user: User
}

export default function EmailCell({ user }: EmailCellProps) {
  return (
    <a href={`mailto:${user.email}`} translate="no">
      {user.email}
    </a>
  )
}
