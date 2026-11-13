import { useTranslation } from 'react-i18next'
import OLTable, { TableContainer } from '@/shared/components/ol/ol-table'
import OLNotification from '@/shared/components/notification'
import { formatDate } from '@/utils/dates'
import FilterDropdown from '../../admin-users/components/filter-dropdown'
import ListSearch from '../../shared/list-search'
import ListFooter from '../../shared/list-footer'
import { usePagedList, useReloadWhenShown } from '../../shared/use-paged-list'

type AuditLogQuery = {
  page: number
  pageSize: number
  search: string
  operation: string
}
type AuditLogResult = {
  query: AuditLogQuery
  total: number
  page: number
  counts: { all: number; operations: { operation: string; count: number }[] }
  entries: {
    operation: string
    timestamp: string
    initiatorId?: string
    initiatorEmail?: string
    ipAddress?: string
    info?: Record<string, unknown>
  }[]
}

// The words of the operations that are names: the original admin page only
// had SSO. A new operation with another one adds it here
const PROPER_NOUNS: Record<string, string> = {
  sso: 'SSO',
  ai: 'AI',
  git: 'Git',
  github: 'GitHub',
  dropbox: 'Dropbox',
}

// "change-primary-email" -> "Change primary email", as the original admin page
const readable = (operation: string) => {
  const label = operation
    .split('-')
    .map(word => PROPER_NOUNS[word] ?? word)
    .join(' ')
  return label.charAt(0).toUpperCase() + label.slice(1)
}

// The user's audit log, newest first, paged and searched in the backend
// (operation or IP address); the operation filter sits in the header
// (also the project page's: the same entries in projectAuditLogEntries);
// on a user's own log, the user's own entries show the email without a link
function AuditLogTab({
  url,
  self,
  active,
}: {
  url: string
  self?: { id: string; email: string }
  // whether its tab shows: opening it again reloads the entries
  active: boolean
}) {
  const { t } = useTranslation()
  const { query, result, loading, error, updateQuery, reload } = usePagedList<
    AuditLogQuery,
    AuditLogResult
  >(url, {
    page: 1,
    pageSize: 10,
    search: '',
    operation: 'all',
  })
  useReloadWhenShown(active, reload)

  const operationOptions = [
    { value: 'all', label: t('all'), count: result?.counts.all ?? 0 },
    ...(result?.counts.operations ?? []).map(op => ({
      value: op.operation,
      label: readable(op.operation),
      count: op.count,
    })),
  ]

  return (
    <>
      <section className="admin-panel-toolbar">
        <ListSearch
          initialValue={query.search}
          loading={loading}
          onSearch={(search, options) => updateQuery({ search }, options)}
          placeholder={t('search_by_operation_or_ip')}
        />
      </section>

      {error && (
        <OLNotification type="error" content={t('generic_something_went_wrong')} className="mb-3" />
      )}

      <div className={loading ? 'admin-panel-table-wrapper admin-panel-loading' : 'admin-panel-table-wrapper'}>
        <TableContainer bordered responsive>
          <OLTable container={false} className="admin-panel-table">
            <thead>
              <tr>
                <th scope="col">{t('date')}</th>
                <th scope="col" className="admin-panel-th-filter">
                  <FilterDropdown
                    id="admin-user-audit-operation"
                    size="sm"
                    toggleText={
                      query.operation === 'all'
                        ? t('operation')
                        : `${t('operation')}: ${readable(query.operation)}`
                    }
                    active={query.operation !== 'all'}
                    options={operationOptions}
                    value={query.operation}
                    onChange={operation => updateQuery({ operation })}
                  />
                </th>
                <th scope="col" className="d-none d-md-table-cell">{t('initiator')}</th>
                <th scope="col" className="d-none d-md-table-cell">{t('ip_address')}</th>
                <th scope="col" className="d-none d-lg-table-cell">{t('info')}</th>
              </tr>
            </thead>
            <tbody>
              {result?.entries.map((entry, i) => (
                <tr key={`${entry.timestamp}-${i}`}>
                  <td className="text-nowrap">{formatDate(entry.timestamp)}</td>
                  <td>{readable(entry.operation)}</td>
                  <td className="d-none d-md-table-cell">
                    {self && entry.initiatorId === self.id ? (
                      self.email
                    ) : entry.initiatorId ? (
                      <a className="admin-panel-plain-link" href={`/admin/user/${entry.initiatorId}`}>
                        {entry.initiatorEmail ?? entry.initiatorId}
                      </a>
                    ) : (
                      <span className="admin-panel-muted">—</span>
                    )}
                  </td>
                  <td className="d-none d-md-table-cell">{entry.ipAddress}</td>
                  <td className="d-none d-lg-table-cell admin-panel-info">
                    {entry.info && Object.keys(entry.info).length > 0 && (
                      <code>{JSON.stringify(entry.info)}</code>
                    )}
                  </td>
                </tr>
              ))}
              {result && result.entries.length === 0 && (
                <tr>
                  <td colSpan={5} className="admin-panel-empty">
                    {t('no_search_results')}
                  </td>
                </tr>
              )}
            </tbody>
          </OLTable>
        </TableContainer>
      </div>

      {result && (
        <ListFooter
          id="admin-user-audit-log"
          shownText={t('showing_x_results_of_total', {
            count: result.entries.length,
            total: result.total,
          })}
          total={result.total}
          page={result.page}
          pageSize={result.query.pageSize}
          onChange={updateQuery}
        />
      )}
    </>
  )
}

export default AuditLogTab
