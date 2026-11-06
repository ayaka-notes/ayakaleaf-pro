import getMeta from '@/utils/meta'
import type { AdminProjectMeta } from './types'

// The page meta is this module's own, so it is not in core's Meta type
export const getAdminProject = () =>
  (getMeta as (name: string) => unknown)('ol-adminProject') as AdminProjectMeta
