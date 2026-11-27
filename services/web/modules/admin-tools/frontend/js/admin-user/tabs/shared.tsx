import MaterialIcon from '@/shared/components/material-icon'
import { formatDate, fromNowDate } from '@/utils/dates'
import { formatLocalDate } from '@/shared/utils/formatDate'

export function BoolIcon({ value, label }: { value: boolean; label: string }) {
  return (
    <span className="admin-panel-bool">
      {value ? (
        <MaterialIcon type="check" className="admin-panel-bool-on" accessibilityLabel={label} />
      ) : (
        <MaterialIcon type="remove" className="admin-panel-muted" accessibilityLabel={label} />
      )}
    </span>
  )
}

// the full date, and how long ago in grey
export function FullDate({ date }: { date?: string }) {
  if (!date) return null
  return (
    <>
      {formatDate(date)}{' '}
      <span className="admin-panel-muted">({fromNowDate(date)})</span>
    </>
  )
}

// a table cell: the day only, as the settings page's git token list; the
// full time with its UTC offset on hover
export function ShortDate({ date }: { date: string }) {
  return <span title={formatLocalDate(date)}>{formatDate(date, 'Do MMM YYYY')}</span>
}
