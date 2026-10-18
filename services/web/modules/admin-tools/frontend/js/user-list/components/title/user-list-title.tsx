import classnames from 'classnames'
import { Filter, useUserListContext } from '../../context/user-list-context'
import { useTranslation } from 'react-i18next'


function UserListTitle({
  filter,
  className,
}: {
  filter: Filter
  className?: string
}) {
  const { filterTranslations } = useUserListContext()

  let message = filterTranslations.get(filter)
  let extraProps = {}
  const { t } = useTranslation()

  return (
    <span
      id="main-content"
      tabIndex={-1}
      className={classnames('user-list-title', className)}
      {...extraProps}
    >
      <a href="/admin/user"
        className="user-list-title-link"
      >{t('user_management')}</a>
      {message ? ` > ${message}` : ''}
    </span>
  )
}

export default UserListTitle
