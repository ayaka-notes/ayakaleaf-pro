export type AuthMethod =
  | { type: 'local' | 'ldap' | 'saml' | 'pending' }
  | { type: 'oidc'; providerId: string; name: string }

export type AdminUser = {
  id: string
  email: string
  firstName?: string
  lastName?: string
  isAdmin: boolean
  suspended: boolean
  loginCount: number
  signUpDate?: string
  lastLoggedIn?: string
  lastActive?: string
  authMethods: AuthMethod[]
  deleted: boolean
  deletedAt?: string
  // the secondary emails the list's search found this user by
  matchedEmails?: MatchedEmail[]
}

export type MatchedEmail = { email: string; confirmed: boolean }

export type UserStatus =
  | 'all'
  | 'active'
  | 'suspended'
  | 'never_logged_in'
  | 'inactive'
  | 'deleted'

export type SortBy =
  | 'name'
  | 'email'
  | 'signUpDate'
  | 'lastLoggedIn'
  | 'lastActive'
  | 'deletedAt'

export type SortOrder = 'asc' | 'desc'

export type UsersQuery = {
  page: number
  pageSize: number
  status: UserStatus
  // 'all' | 'local' | 'ldap' | 'saml' | 'pending' | `oidc:${providerId}`
  auth: string
  role: 'all' | 'admin' | 'user'
  search: string
  sort: SortBy
  order: SortOrder
}

export type UsersResult = {
  users: AdminUser[]
  total: number
  page: number
  query: UsersQuery
  counts: {
    auth: Record<string, number>
    status: Record<UserStatus, number>
    role: { all: number; admin: number; user: number }
    // every account on the instance, without any filter
    users: number
  }
  providers: { id: string; name: string }[]
}

export type AdminUsersOptions = {
  sessionUserId: string
  enabledAuth: { ldap: boolean; saml: boolean; oidc: boolean }
  pageSizes: number[]
  activeUsersCount: number
  // only on /admin/project
  templatesEnabled?: boolean
}
