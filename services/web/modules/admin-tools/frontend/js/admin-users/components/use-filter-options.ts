import { useTranslation } from 'react-i18next'
import { getOptions } from '../meta'
import type { UsersQuery, UsersResult, UserStatus } from '../types'
import { type FilterOption, statusOptionLayout } from './filter-dropdown'

export function useFilterOptions(query: UsersQuery, result: UsersResult) {
  const { t } = useTranslation()
  const { enabledAuth } = getOptions()
  const { auth: authCounts, status: statusCounts } = result.counts

  // A method shows when it is turned on, or when accounts still use it (for
  // example after it was turned off, or an OIDC provider id was changed)
  const show = (enabled: boolean, value: string) =>
    enabled || (authCounts[value] ?? 0) > 0 || query.auth === value

  const auth: FilterOption[] = [
    { value: 'all', label: t('all'), count: authCounts.all ?? 0 },
    { value: 'local', label: t('password'), count: authCounts.local ?? 0 },
    ...(show(enabledAuth.ldap, 'ldap')
      ? [{ value: 'ldap', label: t('ldap'), count: authCounts.ldap ?? 0 }]
      : []),
    ...(show(enabledAuth.saml, 'saml')
      ? [{ value: 'saml', label: t('saml'), count: authCounts.saml ?? 0 }]
      : []),
    ...result.providers
      .filter(({ id }) => show(enabledAuth.oidc, `oidc:${id}`))
      .map(({ id, name }) => ({
        value: `oidc:${id}`,
        label: name,
        count: authCounts[`oidc:${id}`] ?? 0,
      })),
    ...(show(false, 'pending')
      ? [
          {
            value: 'pending',
            label: t('pending'),
            count: authCounts.pending ?? 0,
            help: t('user_login_pending_help'),
          },
        ]
      : []),
  ]

  const statusLabels: Record<UserStatus, string> = {
    all: t('all'),
    active: t('active'),
    suspended: t('disabled'),
    never_logged_in: t('pending'),
    inactive: t('inactive'),
    deleted: t('deleted_user'),
  }
  // Disabled and Deleted user explain themselves
  const statusHelp: Partial<Record<UserStatus, string>> = {
    all: t('user_status_all_help'),
    active: t('user_status_active_help'),
    never_logged_in: t('user_status_pending_help'),
    inactive: t('user_status_inactive_help'),
  }
  const status: FilterOption[] = (Object.keys(statusLabels) as UserStatus[]).map(
    value => ({
      value,
      label: statusLabels[value],
      count: statusCounts[value] ?? 0,
      help: statusHelp[value],
      ...statusOptionLayout(value),
    })
  )

  const role: FilterOption[] = [
    { value: 'all', label: t('all'), count: result.counts.role.all },
    { value: 'admin', label: t('admin_titlecase'), count: result.counts.role.admin },
    { value: 'user', label: t('user'), count: result.counts.role.user },
  ]

  return { auth, status, role }
}
