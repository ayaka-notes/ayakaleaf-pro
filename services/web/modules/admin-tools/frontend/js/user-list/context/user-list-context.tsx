import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import {
  filter as arrayFilter,
} from 'lodash'
import { useTranslation } from 'react-i18next'
import getMeta from '@/utils/meta'
import { debugConsole } from '@/utils/debugging'
import useAsync from '@/shared/hooks/use-async'
import usePersistedState from '@/shared/hooks/use-persisted-state'
import {
  GetUsersResponseBody,
  User,
  Sort,
} from '../../../../types/user/api'
import { getUsers, searchUsers } from '../util/api'
import sortUsers from '../util/sort-users'

import { UserIdentityProvider } from './user-identity-context'

const MAX_USER_PER_PAGE = 10

type AuthMethods = 'local' | 'ldap' | 'saml' | 'oidc'
export type Filter = 'all' | 'admin' | 'suspended' | 'inactive' | AuthMethods | 'deleted'

const selfId = getMeta('ol-user_id')
const availableAuthMethods: AuthMethods[] = getMeta('ol-availableAuthMethods') ?? []

type FilterMap = {
  [key in Filter]: Partial<User> | ((user: User) => boolean)
}

const filters: FilterMap = {
  all: { deleted: false },
  admin: { isAdmin: true, deleted: false },
  suspended: { suspended: true, deleted: false },
  inactive: { inactive: true, deleted: false },
  deleted: { deleted: true },
  ...Object.fromEntries(
    availableAuthMethods.map(method => [
      method,
      (user: User) => user.authMethods.includes(method) && !user.deleted
    ])
  )
}

// if there is only one authentication source we won't show "users by authentication" lists
const filterKeys: Filter[] = [
  'all',
  'admin',
  'suspended',
  'inactive',
  ...(availableAuthMethods.length === 1 ? [] : availableAuthMethods),
  'deleted'
]

export type UserListContextValue = {
  addUserToView: (user: Partial<User>) => void
  error: Error | null
  filter: Filter
  filterTranslations: Map<Filter, string>
  hiddenUsersCount: number
  isLoading: ReturnType<typeof useAsync>['isLoading']
  loadMoreCount: number
  loadMoreUsers: () => void
  loadProgress: number
  removeUserFromView: (user: User) => void
  searchText: string
  selectFilter: (filter: Filter) => void
  selectedUserIds: Set<string>
  selectedUsers: User[]
  selectOrUnselectAllUsers: React.Dispatch<React.SetStateAction<boolean>>
  selfVisibleCount: number
  setSearchText: React.Dispatch<React.SetStateAction<string>>
  setSelectedUserIds: React.Dispatch<React.SetStateAction<Set<string>>>
  setSort: React.Dispatch<React.SetStateAction<Sort>>
  showAllUsers: () => void
  sort: Sort
  toggleSelectedUser: (userId: string, selected?: boolean) => void
  totalUsersCount: number
  updateUserViewData: (newUserData: User) => void
  loadedUsers: User[]
  visibleUsers: User[]
}

export const UserListContext = createContext<
  UserListContextValue | undefined
>(undefined)

type UserListProviderProps = {
  children: ReactNode
}

export function UserListProvider({ children }: UserListProviderProps) {
  const prefetchedUsersBlob = getMeta('ol-prefetchedUsersBlob')
  const [loadedUsers, setLoadedUsers] = useState<User[]>(
    prefetchedUsersBlob?.users ?? []
  )

  const [maxVisibleUsers, setMaxVisibleUsers] =
    useState(MAX_USER_PER_PAGE)

  const [loadProgress, setLoadProgress] = useState(
    prefetchedUsersBlob ? 100 : 20
  )
  const [totalUsersCount, setTotalUsersCount] = useState<number>(
    prefetchedUsersBlob?.totalSize ?? 0
  )
  const [sort, setSort] = useState<Sort>({
    by: 'name',
    order: 'asc',
  })

  const { t } = useTranslation()
  const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
  const filterTranslations = useMemo(() => {
    const labels: Record<Filter, string> = {
      all: t('all'),
      admin: t('admin'),
      suspended: t('disabled'),
      inactive: t('inactive'),
      deleted: t('deleted_user'),
      local: t('local'),
      ldap: t('ldap'),
      saml: t('saml'),
      oidc: t('oidc'),
    }
    return new Map(filterKeys.map(key => [key, capitalize(labels[key])]))
  }, [t])

  const [filter, setFilter] = usePersistedState<Filter>(
    'user-list-filter',
    'all'
  )

  const [searchText, setSearchText] = useState('')
  const [searchResults, setSearchResults] = useState<User[] | null>(null)

  const {
    isLoading: loading,
    isIdle,
    error,
    runAsync,
  } = useAsync<GetUsersResponseBody>({
    status: prefetchedUsersBlob ? 'resolved' : 'pending',
    data: prefetchedUsersBlob,
  })
  const isLoading = isIdle ? true : loading

  useEffect(() => {
    if (prefetchedUsersBlob) return
    setLoadProgress(40)
    runAsync(getUsers({ by: 'signUpDate', order: 'desc' }))
      .then(data => {
        setLoadedUsers(data.users)
        setTotalUsersCount(data.totalSize)
      })
      .catch(debugConsole.error)
      .finally(() => {
        setLoadProgress(100)
      })
  }, [prefetchedUsersBlob, runAsync])

  useEffect(() => {
    if (!searchText.length) {
      setSearchResults(null)
      return
    }
    const abortController = new AbortController()
    const timer = setTimeout(() => {
      searchUsers(searchText, abortController.signal)
        .then(data => {
          setSearchResults(data.users)
        })
        .catch(error => {
          if (error.name === 'AbortError') {
            debugConsole.log('Search aborted')
            return
          }
          debugConsole.error('Error searching users:', error)
          setSearchResults(null)
        })
    }, 300) // 300ms debounce

    return () => {
      clearTimeout(timer)
      abortController.abort()
    }
  }, [searchText])

  const addUserToView = useCallback((newUser: Partial<User>) => {
    setLoadedUsers(prev => [newUser as User, ...prev])
  }, [])

  const processedUsers = useMemo(() => {
    let users = searchResults !== null ? searchResults : loadedUsers
    users = arrayFilter(users, filters[filter])
    return sortUsers(users, sort)
  }, [searchResults, loadedUsers, filter, sort])

  const visibleUsers = useMemo(() => {
    return processedUsers.slice(0, maxVisibleUsers)
  }, [processedUsers, maxVisibleUsers])

  const hiddenUsersCount = Math.max(
    processedUsers.length - visibleUsers.length,
    0
  )

  const loadMoreCount = Math.min(
    hiddenUsersCount,
    MAX_USER_PER_PAGE
  )

  const selfVisibleCount = useMemo(() => {
    return visibleUsers.some(u => u.id === selfId) ? 1 : 0
  }, [visibleUsers])

  const showAllUsers = useCallback(() => {
    setMaxVisibleUsers(maxVisibleUsers + hiddenUsersCount)
  }, [hiddenUsersCount, maxVisibleUsers])

  const loadMoreUsers = useCallback(() => {
    setMaxVisibleUsers(maxVisibleUsers + loadMoreCount)
  }, [maxVisibleUsers, loadMoreCount])

  const [selectedUserIds, setSelectedUserIds] = useState(
    () => new Set<string>()
  )

  const toggleSelectedUser = useCallback(
    (userId: string, selected?: boolean) => {
      setSelectedUserIds(prevSelectedUserIds => {
        const selectedUserIds = new Set(prevSelectedUserIds)
        if (selected === true) {
          selectedUserIds.add(userId)
        } else if (selected === false) {
          selectedUserIds.delete(userId)
        } else if (selectedUserIds.has(userId)) {
          selectedUserIds.delete(userId)
        } else {
          selectedUserIds.add(userId)
        }
        return selectedUserIds
      })
    },
    []
  )

  const selectedUsers = useMemo(() => {
    return processedUsers.filter(user => selectedUserIds.has(user.id))
  }, [selectedUserIds, processedUsers])

  const selectOrUnselectAllUsers = useCallback(
    (checked: any) => {
      setSelectedUserIds(prevSelectedUserIds => {
        const selectedUserIds = new Set(prevSelectedUserIds)
        for (const user of visibleUsers) {
          if (user.id === selfId) {
            selectedUserIds.delete(user.id)
            continue
          }
          if (checked) {
            selectedUserIds.add(user.id)
          } else {
            selectedUserIds.delete(user.id)
          }
        }
        return selectedUserIds
      })
    },
    [visibleUsers]
  )

  const selectFilter = useCallback(
    (filter: Filter) => {
      setFilter(filter)

      setSort(prev => {
        if (filter === 'deleted' && prev.by === 'signUpDate') {
          return { ...prev, by: 'deletedAt' }
        }
        if (filter !== 'deleted' && prev.by === 'deletedAt') {
          return { ...prev, by: 'signUpDate' }
        }
        return prev
      })

      const selected = false
      selectOrUnselectAllUsers(selected)
    },
    [selectOrUnselectAllUsers, setFilter]
  )

  const updateUserViewData = useCallback((newUserData: User) => {
    setSearchResults(users =>
      users?.map(user => user.id === newUserData.id ? newUserData : user) ?? null
    )
    setLoadedUsers(loadedUsers => {
      return loadedUsers.map(u =>
        u.id === newUserData.id ? { ...newUserData } : u
      )
    })
  }, [])

  const removeUserFromView = useCallback((user: User) => {
    setLoadedUsers(loadedUsers => {
      return loadedUsers.filter(u => u.id !== user.id)
    })
  }, [])

  const value = useMemo<UserListContextValue>(
    () => ({
      addUserToView,
      error,
      filter,
      filterTranslations,
      hiddenUsersCount,
      isLoading,
      loadMoreCount,
      loadMoreUsers,
      loadProgress,
      removeUserFromView,
      searchText,
      selectFilter,
      selectedUserIds,
      selectedUsers,
      selectOrUnselectAllUsers,
      selfVisibleCount,
      setSearchText,
      setSelectedUserIds,
      setSort,
      showAllUsers,
      sort,
      toggleSelectedUser,
      totalUsersCount,
      updateUserViewData,
      loadedUsers,
      visibleUsers,
    }),
    [
      addUserToView,
      error,
      filter,
      filterTranslations,
      hiddenUsersCount,
      isLoading,
      loadMoreCount,
      loadMoreUsers,
      loadProgress,
      removeUserFromView,
      searchText,
      selectFilter,
      selectedUserIds,
      selectedUsers,
      selectOrUnselectAllUsers,
      selfVisibleCount,
      setSearchText,
      setSelectedUserIds,
      setSort,
      showAllUsers,
      sort,
      toggleSelectedUser,
      totalUsersCount,
      updateUserViewData,
      loadedUsers,
      visibleUsers,
    ]
  )

  if (!loadedUsers || loadedUsers.length === 0) {
    return null
  }

  return (
    <UserIdentityProvider users={loadedUsers}>
      <UserListContext.Provider value={value}>
        {children}
      </UserListContext.Provider>
    </UserIdentityProvider>
  )
}

export function useUserListContext() {
  const context = useContext(UserListContext)
  if (!context) {
    throw new Error(
      'UserListContext is only available inside UserListProvider'
    )
  }
  return context
}
