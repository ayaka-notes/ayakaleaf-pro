import { useTranslation } from 'react-i18next'
import classnames from 'classnames'
import { formatDate, fromNowDate } from '@/utils/dates'
import OLTable, { TableContainer } from '@/shared/components/ol/ol-table'
import OLFormCheckbox from '@/shared/components/ol/ol-form-checkbox'
import { getOptions } from '../meta'
import type { useSelection } from '../../shared/selection'
import UserActions from './user-actions'
import SortHeader from '../../shared/sort-header'
import type {
  AdminUser,
  AuthMethod,
  MatchedEmail,
  SortBy,
  UsersQuery,
  UsersResult,
  UserStatus,
} from '../types'
import FilterDropdown, { FilterOption } from './filter-dropdown'
import { useFilterOptions } from './use-filter-options'

type UpdateQuery = (update: Partial<UsersQuery>) => void

function SortableHeader({
  sortBy,
  label,
  query,
  updateQuery,
  className,
}: {
  sortBy: SortBy
  label: string
  query: UsersQuery
  updateQuery: UpdateQuery
  className?: string
}) {
  const active = query.sort === sortBy
  const nextOrder = active
    ? query.order === 'asc'
      ? 'desc'
      : 'asc'
    : sortBy === 'name' || sortBy === 'email'
      ? 'asc'
      : 'desc'
  return (
    <SortHeader
      label={label}
      active={active}
      order={query.order}
      className={className}
      onSort={() => updateQuery({ sort: sortBy, order: nextOrder })}
    />
  )
}

function FilterHeader({
  id,
  title,
  options,
  value,
  onChange,
  className,
}: {
  id: string
  title: string
  options: FilterOption[]
  value: string
  onChange: (value: string) => void
  className?: string
}) {
  const selected = options.find(option => option.value === value)
  const active = value !== 'all'
  return (
    <th scope="col" className={classnames('admin-panel-th-filter', className)}>
      <FilterDropdown
        id={id}
        size="sm"
        toggleText={active && selected ? `${title}: ${selected.label}` : title}
        active={active}
        options={options}
        value={value}
        onChange={onChange}
      />
    </th>
  )
}

export function AuthBadge({ method }: { method: AuthMethod }) {
  const { t } = useTranslation()
  switch (method.type) {
    case 'local':
      return (
        <span className="admin-panel-badge admin-panel-badge-local">
          {t('password')}
        </span>
      )
    case 'ldap':
      return (
        <span className="admin-panel-badge admin-panel-badge-ldap">{t('ldap')}</span>
      )
    case 'saml':
      return (
        <span className="admin-panel-badge admin-panel-badge-saml">{t('saml')}</span>
      )
    case 'oidc':
      return (
        <span
          className="admin-panel-badge admin-panel-badge-oidc"
          title={method.providerId}
        >
          {method.name}
        </span>
      )
    case 'pending':
      return (
        <span className="admin-panel-badge">
          {t('pending')}
        </span>
      )
  }
}

// CE has one permission role, the site admin; everyone else is a user
export function RoleBadge({ isAdmin }: { isAdmin: boolean }) {
  const { t } = useTranslation()
  return isAdmin ? (
    <span className="admin-panel-badge admin-panel-badge-admin">
      {t('admin_titlecase')}
    </span>
  ) : (
    <span className="admin-panel-badge">{t('user')}</span>
  )
}

export function StatusBadge({ user }: { user: AdminUser }) {
  const { t } = useTranslation()
  if (user.deleted) {
    return (
      <span className="admin-panel-badge admin-panel-badge-danger">
        {t('deleted_user')}
      </span>
    )
  }
  if (user.suspended) {
    return (
      <span className="admin-panel-badge admin-panel-badge-danger">
        {t('disabled')}
      </span>
    )
  }
  // never logged in: what the Status filter calls Pending (an account
  // waiting for its activation or its first SSO login)
  if (!user.loginCount) {
    return <span className="admin-panel-badge">{t('pending')}</span>
  }
  // no login and not in the editor for a year: what the filter calls Inactive
  const yearAgo = new Date()
  yearAgo.setFullYear(yearAgo.getFullYear() - 1)
  const usedThisYear = [user.lastActive, user.lastLoggedIn].some(
    date => date && new Date(date) >= yearAgo
  )
  if (!usedThisYear) {
    return <span className="admin-panel-badge">{t('inactive')}</span>
  }
  return (
    <span className="admin-panel-badge admin-panel-badge-positive">
      {t('active')}
    </span>
  )
}

export function RelativeDate({ date }: { date?: string }) {
  if (!date) return <span className="admin-panel-muted">—</span>
  return <span title={formatDate(date)}>{fromNowDate(date)}</span>
}

// Columns as the window narrows: below 768px only the user and the actions,
// below 576px only the user
const COLUMN = {
  login: 'd-none d-md-table-cell',
  role: 'd-none d-lg-table-cell',
  status: 'd-none d-md-table-cell',
  signUp: 'd-none d-xl-table-cell',
  lastLoggedIn: 'd-none d-lg-table-cell',
  actions: 'd-none d-sm-table-cell',
}

// Which email is the primary one, once a row shows more than one
export function PrimaryBadge() {
  const { t } = useTranslation()
  return (
    <span className="admin-panel-badge admin-panel-badge-info">
      {t('primary')}
    </span>
  )
}

// The secondary emails a search found a row by, each on a line under the
// primary one, marked as on the user's page
export function MatchedEmails({
  emails,
  className = 'admin-panel-user-email',
}: {
  emails: MatchedEmail[]
  className?: string
}) {
  const { t } = useTranslation()
  return emails.map(({ email, confirmed }) => (
    <div
      key={email}
      className={classnames(className, 'admin-panel-inline-field')}
    >
      {email}
      {!confirmed && (
        <span className="admin-panel-badge">{t('unconfirmed')}</span>
      )}
    </div>
  ))
}

function UserRow({
  user,
  onActionDone,
  selected,
  onSelect,
}: {
  user: AdminUser
  onActionDone: () => void
  selected: boolean
  onSelect: (checked: boolean) => void
}) {
  const { t } = useTranslation()
  const { sessionUserId } = getOptions()
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ')
  const matchedEmails = user.matchedEmails ?? []
  const primaryBadge = matchedEmails.length > 0 && <PrimaryBadge />

  return (
    <tr>
      <td className="admin-panel-cell-checkbox d-none d-md-table-cell">
        <OLFormCheckbox
          id={`admin-users-select-${user.id}`}
          autoComplete="off"
          aria-label={`${t('select_user')} ${user.email}`}
          checked={selected}
          disabled={user.id === sessionUserId}
          onChange={event => onSelect(event.target.checked)}
        />
      </td>
      <td className="admin-panel-cell-user">
        <div className="admin-panel-user-name">
          <a href={`/admin/user/${user.id}`}>{name || user.email}</a>
          {!name && primaryBadge}
          {user.id === sessionUserId && (
            <span className="admin-panel-badge admin-panel-badge-info">
              {t('you')}
            </span>
          )}
        </div>
        {name && (
          <div
            className={classnames('admin-panel-user-email', {
              'admin-panel-inline-field': primaryBadge,
            })}
          >
            {user.email}
            {primaryBadge}
          </div>
        )}
        <MatchedEmails emails={matchedEmails} />
      </td>
      <td className={COLUMN.login}>
        <div className="admin-panel-badges">
          {user.authMethods.map(method => (
            <AuthBadge
              key={method.type === 'oidc' ? method.providerId : method.type}
              method={method}
            />
          ))}
        </div>
      </td>
      <td className={COLUMN.role}>
        <div className="admin-panel-badges">
          <RoleBadge isAdmin={user.isAdmin} />
        </div>
      </td>
      <td className={COLUMN.status}>
        <div className="admin-panel-badges">
          <StatusBadge user={user} />
        </div>
      </td>
      <td className={COLUMN.signUp}>
        <RelativeDate date={user.signUpDate} />
      </td>
      <td className={COLUMN.lastLoggedIn}>
        <RelativeDate date={user.deleted ? user.deletedAt : user.lastLoggedIn} />
      </td>
      <td className={classnames('admin-panel-cell-actions', COLUMN.actions)}>
        <UserActions user={user} onDone={onActionDone} />
      </td>
    </tr>
  )
}

function UsersTable({
  query,
  result,
  loading,
  updateQuery,
  onActionDone,
  selection,
}: {
  query: UsersQuery
  result: UsersResult
  loading: boolean
  updateQuery: UpdateQuery
  onActionDone: () => void
  selection: ReturnType<typeof useSelection>
}) {
  const { t } = useTranslation()
  const { sessionUserId } = getOptions()
  const users = result.users
  // the own account cannot be disabled or deleted, so it is not ticked
  const selectable = users.filter(user => user.id !== sessionUserId).map(user => user.id)
  const allSelected =
    selectable.length > 0 && selectable.every(id => selection.selected.has(id))
  const filters = useFilterOptions(query, result)
  const deleted = query.status === 'deleted'
  const headerProps = { query, updateQuery }

  return (
    // core's bordered table panel
    <div
      className={classnames('admin-panel-table-wrapper', {
        'admin-panel-loading': loading,
      })}
      aria-busy={loading}
    >
      <TableContainer bordered responsive>
      <OLTable container={false} className="admin-panel-table">
        <thead>
          <tr>
            <th className="admin-panel-cell-checkbox d-none d-md-table-cell">
              <OLFormCheckbox
                id="admin-users-select-all"
                autoComplete="off"
                aria-label={t('select_all')}
                checked={allSelected}
                disabled={selectable.length === 0}
                onChange={event => selection.setAll(selectable, event.target.checked)}
              />
            </th>
            <SortableHeader sortBy="name" label={t('name')} {...headerProps} />
            <FilterHeader
              id="admin-users-filter-auth"
              title={t('login')}
              className={COLUMN.login}
              options={filters.auth}
              value={query.auth}
              onChange={auth => updateQuery({ auth })}
            />
            <FilterHeader
              id="admin-users-filter-role"
              title={t('role')}
              className={COLUMN.role}
              options={filters.role}
              value={query.role}
              onChange={role => updateQuery({ role: role as UsersQuery['role'] })}
            />
            <FilterHeader
              id="admin-users-filter-status"
              title={t('status')}
              className={COLUMN.status}
              options={filters.status}
              value={query.status}
              onChange={status =>
                updateQuery({
                  status: status as UserStatus,
                  // the deleted-at sort exists only for deleted users
                  ...(query.sort === 'deletedAt' && status !== 'deleted'
                    ? { sort: 'signUpDate', order: 'desc' }
                    : {}),
                })
              }
            />
            <SortableHeader
              sortBy="signUpDate"
              label={t('sign_up')}
              className={COLUMN.signUp}
              {...headerProps}
            />
            <SortableHeader
              sortBy={deleted ? 'deletedAt' : 'lastLoggedIn'}
              label={deleted ? t('deleted_at') : t('last_logged_in')}
              className={COLUMN.lastLoggedIn}
              {...headerProps}
            />
            <th
              scope="col"
              className={classnames('admin-panel-cell-actions', COLUMN.actions)}
            >
              {t('actions')}
            </th>
          </tr>
        </thead>
        <tbody>
          {users.map(user => (
            <UserRow
              key={user.id}
              user={user}
              onActionDone={onActionDone}
              selected={selection.selected.has(user.id)}
              onSelect={checked => selection.toggle(user.id, checked)}
            />
          ))}
          {users.length === 0 && (
            <tr>
              <td colSpan={8} className="admin-panel-empty">
                {t('no_search_results')}
              </td>
            </tr>
          )}
        </tbody>
      </OLTable>
      </TableContainer>
    </div>
  )
}

export default UsersTable
