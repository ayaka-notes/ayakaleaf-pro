import { useTranslation } from 'react-i18next'
import ListSearch from '../../shared/list-search'
import type { UsersQuery } from '../types'
import { CreateUserButton } from './user-actions'

// As on the original admin page: the search box and the create button. The
// filters sit in the table header.
function UsersToolbar({
  query,
  loading,
  updateQuery,
  onCreated,
  bulkActions,
}: {
  query: UsersQuery
  loading: boolean
  updateQuery: (
    update: Partial<UsersQuery>,
    options?: { debounce?: boolean }
  ) => void
  onCreated: () => void
  // the ticked users' bulk buttons, left of Create account
  bulkActions?: React.ReactNode
}) {
  const { t } = useTranslation()

  return (
    <section className="admin-panel-toolbar">
      <ListSearch
        initialValue={query.search}
        loading={loading}
        onSearch={(search, options) => updateQuery({ search }, options)}
        placeholder={t('search_by_name_email_or_id')}
      />
      <div className="admin-panel-toolbar-actions">
        {bulkActions}
        <CreateUserButton onDone={onCreated} />
      </div>
    </section>
  )
}

export default UsersToolbar
