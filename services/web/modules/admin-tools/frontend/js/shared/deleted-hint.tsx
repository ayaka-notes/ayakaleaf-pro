// As on the original admin page, a search also tells how many deleted
// entries match and switches to them; one plain line above the table, no box
function DeletedHint({
  search,
  showingDeleted,
  count,
  foundText,
  showText,
  hideText,
  onShow,
  onHide,
}: {
  search: string
  showingDeleted: boolean
  count: number
  foundText: string
  showText: string
  hideText: string
  onShow: () => void
  onHide: () => void
}) {
  if (!search) return null

  if (showingDeleted) {
    return (
      <p className="admin-panel-hint">
        <button type="button" className="admin-panel-hint-link" onClick={onHide}>
          {hideText}
        </button>
      </p>
    )
  }

  if (count === 0) return null
  return (
    <p className="admin-panel-hint">
      {foundText} ·{' '}
      <button type="button" className="admin-panel-hint-link" onClick={onShow}>
        {showText}
      </button>
    </p>
  )
}

export default DeletedHint
