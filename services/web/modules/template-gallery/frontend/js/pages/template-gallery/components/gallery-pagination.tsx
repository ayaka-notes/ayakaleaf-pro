import { useTranslation } from 'react-i18next'

type GalleryPaginationProps = {
  currentPage: number
  totalPages: number
  onPageChange: (page: number) => void
  // max number of page buttons on either side of the current page
  maxButtons?: number
}

/**
 * React port of the upstream gallery pagination
 * (app/views/_mixins/pagination.pug): First/Prev, up to `maxButtons` pages on
 * each side of the current page, ellipses, Next/Last. Same markup and i18n
 * keys, buttons instead of links since paging happens client-side.
 */
export default function GalleryPagination({
  currentPage,
  totalPages,
  onPageChange,
  maxButtons = 4,
}: GalleryPaginationProps) {
  const { t } = useTranslation()
  if (!currentPage || !totalPages || totalPages <= 1) return null

  const prevPages: number[] = []
  for (let p = Math.max(currentPage - maxButtons, 1); p < currentPage; p++) {
    prevPages.push(p)
  }
  const nextPages: number[] = []
  for (
    let p = currentPage + 1;
    p <= totalPages && nextPages.length < maxButtons;
    p++
  ) {
    nextPages.push(p)
  }
  const moreBefore = currentPage - maxButtons > 1
  const moreAfter = currentPage + nextPages.length < totalPages

  return (
    <nav role="navigation" aria-label={t('pagination_navigation')}>
      <ul className="pagination">
        {currentPage > 1 && (
          <>
            <li>
              <button
                aria-label={t('go_to_first_page')}
                onClick={() => onPageChange(1)}
              >
                <span aria-hidden="true">&lt;&lt;</span> First
              </button>
            </li>
            <li>
              <button
                aria-label={t('go_to_previous_page')}
                onClick={() => onPageChange(currentPage - 1)}
              >
                <span aria-hidden="true">&lt;</span> Prev
              </button>
            </li>
          </>
        )}

        {moreBefore && (
          <li aria-hidden="true">
            <span>…</span>
          </li>
        )}

        {prevPages.map(page => (
          <li key={page}>
            <button
              aria-label={t('go_to_page_x', { page })}
              onClick={() => onPageChange(page)}
            >
              {page}
            </button>
          </li>
        ))}

        <li className="active">
          <span
            aria-label={t('current_page_page', { page: currentPage })}
            aria-current="true"
          >
            {currentPage}
          </span>
        </li>

        {currentPage < totalPages && (
          <>
            {nextPages.map(page => (
              <li key={page}>
                <button
                  aria-label={t('go_to_page_x', { page })}
                  onClick={() => onPageChange(page)}
                >
                  {page}
                </button>
              </li>
            ))}

            {moreAfter && (
              <li className="ellipses" aria-hidden="true">
                <span>…</span>
              </li>
            )}

            <li>
              <button
                aria-label={t('go_to_next_page')}
                onClick={() => onPageChange(currentPage + 1)}
              >
                Next <span aria-hidden="true">&gt;</span>
              </button>
            </li>
            <li>
              <button
                aria-label={t('go_to_last_page')}
                onClick={() => onPageChange(totalPages)}
              >
                Last <span aria-hidden="true">&gt;&gt;</span>
              </button>
            </li>
          </>
        )}
      </ul>
    </nav>
  )
}
