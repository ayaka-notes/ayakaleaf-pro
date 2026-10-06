import { SortingOrder } from '../../../../types/sorting-order'
import { MergeAndOverride } from '../../../../types/utils'

export type Page = {
  size: number
  lastId?: string
}

export type Sort = {
  by: 'lastLoggedIn' | 'lastActive' | 'signUpDate' | 'deletedAt' | 'email' | 'name'
  order: SortingOrder
}

export type Filters = {
  all?: boolean
  admin?: boolean
  inactive?: boolean
  suspended?: boolean
  deleted?: boolean
  local?: boolean
  saml?: boolean
  oidc?: boolean
  ldap?: boolean
  search?: string
}

export type GetUsersRequestBody = {
  page: Page
  sort: Sort
  filters: Filters
}

export type UserApi = {
  id: string
  email: string
  firstName: string
  lastName: string
  isAdmin: boolean
  loginCount: number
  signUpDate: Date
  lastActive?: Date
  lastLoggedIn?: Date
  authMethods: string[]
  allowUpdateDetails: boolean
  allowUpdateIsAdmin: boolean
  suspended: boolean
  inactive: boolean
  deleted?: boolean
  deletedAt?: Date
  aiFeatures?: {
    enabled: boolean
  }
  features?: {
    collaborators?: number
    compileTimeout?: number
  }
}

export type User = MergeAndOverride<
  UserApi,
  {
    signUpDate: string
    lastActive?: string
    lastLoggedIn?: string
    deletedAt?: string
    selected?: boolean
  }
>

export type GetUsersResponseBody = {
  totalSize: number
  users: User[]
}
