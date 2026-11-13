import { useTranslation } from 'react-i18next'
import Pagination from '@/shared/components/pagination'
import MaterialIcon from '@/shared/components/material-icon'
import FilterDropdown from '../admin-users/components/filter-dropdown'

export const PAGE_SIZES = [10, 20, 50, 100, 200]

// The footer of every admin list: "Showing x out of n …", core's pagination
// with first / last page around it, and the page size
function ListFooter({
  id,
  shownText,
  total,
  page,
  pageSize,
  onChange,
}: {
  id: string
  shownText: string
  total: number
  page: number
  pageSize: number
  onChange: (update: { page?: number; pageSize?: number }) => void
}) {
  const { t } = useTranslation()
  const totalPages = Math.max(Math.ceil(total / pageSize), 1)

  return (
    <footer className="admin-panel-footer">
      <span className="admin-panel-muted">{shownText}</span>
      {/* core's pagination has previous and next; first and last page sit
          around it in the same markup, with upstream's labels */}
      <div className="admin-panel-pagination">
        {page > 1 && (
          <ul className="pagination">
            <li>
              <button
                type="button"
                aria-label={t('go_to_first_page')}
                onClick={() => onChange({ page: 1 })}
              >
                <MaterialIcon type="first_page" />
              </button>
            </li>
          </ul>
        )}
        <Pagination
          currentPage={page}
          totalPages={totalPages}
          handlePageClick={(_event: unknown, page: number) => onChange({ page })}
        />
        {page < totalPages && (
          <ul className="pagination">
            <li>
              <button
                type="button"
                aria-label={t('go_to_last_page')}
                onClick={() => onChange({ page: totalPages })}
              >
                <MaterialIcon type="last_page" />
              </button>
            </li>
          </ul>
        )}
      </div>
      <FilterDropdown
        id={`${id}-page-size`}
        toggleText={t('items_per_page_x', { count: pageSize })}
        align="end"
        drop="up"
        options={PAGE_SIZES.map(size => ({
          value: String(size),
          label: t('items_per_page_x', { count: size }),
        }))}
        value={String(pageSize)}
        onChange={value => onChange({ pageSize: parseInt(value, 10) })}
      />
    </footer>
  )
}

export default ListFooter
