import getMeta from '@/utils/meta'
import type { AdminUsersOptions, UsersResult } from './types'

// The page metas are this module's own, so they are not in core's Meta type
const getModuleMeta = getMeta as (name: string) => unknown

export const getInitialResult = () =>
  getModuleMeta('ol-adminUsersInitialResult') as UsersResult

export const getOptions = () =>
  getModuleMeta('ol-adminUsersOptions') as AdminUsersOptions
