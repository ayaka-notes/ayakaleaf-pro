import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import OLNotification from '@/shared/components/notification'
import { getInitialResult } from '../meta'
import type { UsersQuery, UsersResult } from '../types'
import { useUsers } from '../use-users'
import UsersToolbar from './users-toolbar'
import UsersTable from './users-table'
import UsersFooter from './users-footer'
import DeletedHint from '../../shared/deleted-hint'
import { useSelection } from '../../shared/selection'
import UsersBulkActions from './bulk-actions'

function DeletedUsersHint({
  query,
  result,
  updateQuery,
}: {
  query: UsersQuery
  result: UsersResult
  updateQuery: (update: Partial<UsersQuery>) => void
}) {
  const { t } = useTranslation()
  const count = result.counts.status.deleted
  return (
    <DeletedHint
      search={query.search}
      showingDeleted={query.status === 'deleted'}
      count={count}
      foundText={t('found_matching_deleted_users', { count })}
      showText={t('display_deleted_user')}
      hideText={t('hide_deleted_user')}
      onShow={() => updateQuery({ status: 'deleted' })}
      onHide={() => updateQuery({ status: 'all' })}
    />
  )
}

function UsersPage() {
  const { t } = useTranslation()
  const { query, result, loading, error, updateQuery, reload } = useUsers(
    getInitialResult()
  )
  // ticked rows for the bulk actions; a new page, filter or search clears them
  const selection = useSelection()
  const { clear } = selection
  useEffect(() => clear(), [query, clear])
  const done = () => {
    clear()
    reload()
  }
  const selectedUsers = result.users.filter(user => selection.selected.has(user.id))

  return (
    <div className="admin-panel-content">
      <UsersToolbar
        query={query}
        loading={loading}
        updateQuery={updateQuery}
        onCreated={reload}
        bulkActions={
          <UsersBulkActions
            users={selectedUsers}
            // the shown rows' status: right after a switch to Deleted the
            // ticked rows are still the live ones until the answer comes
            deleted={result.query.status === 'deleted'}
            onDone={done}
          />
        }
      />

      <DeletedUsersHint
        query={query}
        result={result}
        updateQuery={updateQuery}
      />

      {error && (
        <OLNotification
          type="error"
          content={t('generic_something_went_wrong')}
          className="mb-3"
        />
      )}

      <UsersTable
        query={query}
        result={result}
        loading={loading}
        updateQuery={updateQuery}
        onActionDone={done}
        selection={selection}
      />

      <UsersFooter
        query={query}
        result={result}
        updateQuery={updateQuery}
        selectedCount={selectedUsers.length}
      />
    </div>
  )
}

export default UsersPage
