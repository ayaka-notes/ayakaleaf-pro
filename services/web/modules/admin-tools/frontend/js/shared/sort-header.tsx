import { useTranslation } from 'react-i18next'
import MaterialIcon from '@/shared/components/material-icon'

// Same markup and icons as core's project list sort buttons
// (project-list-table.tsx, sort/with-content.tsx): only the sorted column
// shows an arrow
function SortHeader({
  label,
  active,
  order,
  onSort,
  className,
}: {
  label: string
  active: boolean
  order: 'asc' | 'desc'
  onSort: () => void
  className?: string
}) {
  const { t } = useTranslation()
  const iconType = active
    ? order === 'asc'
      ? 'arrow_upward_alt'
      : 'arrow_downward_alt'
    : undefined

  return (
    <th
      scope="col"
      className={className}
      aria-sort={active ? (order === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        className="admin-panel-sort"
        aria-label={
          active ? t('reverse_x_sort_order', { x: label }) : t('sort_by_x', { x: label })
        }
        onClick={onSort}
      >
        <span>{label}</span>
        {iconType && <MaterialIcon type={iconType} />}
      </button>
    </th>
  )
}

export default SortHeader
