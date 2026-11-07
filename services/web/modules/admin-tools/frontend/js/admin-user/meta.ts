import getMeta from '@/utils/meta'
import type { AdminUserMeta } from './types'

// The page meta is this module's own, so it is not in core's Meta type
export const getAdminUser = () =>
  (getMeta as (name: string) => unknown)('ol-adminUser') as AdminUserMeta
