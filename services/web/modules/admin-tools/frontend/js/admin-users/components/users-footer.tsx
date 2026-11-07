import { useTranslation } from 'react-i18next'
import ListFooter from '../../shared/list-footer'
import type { UsersQuery, UsersResult } from '../types'

function UsersFooter({
  result,
  updateQuery,
  selectedCount = 0,
}: {
  query: UsersQuery
  result: UsersResult
  updateQuery: (update: Partial<UsersQuery>) => void
  // with rows ticked, the line says how many instead
  selectedCount?: number
}) {
  const { t } = useTranslation()
  return (
    <ListFooter
      id="admin-users"
      shownText={
        selectedCount > 0
          ? t('x_selected', { count: selectedCount })
          : t('showing_x_out_of_n_users', {
              x: result.users.length,
              n: result.total,
            })
      }
      total={result.total}
      page={result.page}
      pageSize={result.query.pageSize}
      onChange={updateQuery}
    />
  )
}

export default UsersFooter
