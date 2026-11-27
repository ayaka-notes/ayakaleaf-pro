/**
 * Row-anchored list scroll position for the visual bib editor.
 *
 * Captures the first visible row (binary search over row geometry) plus its
 * in-row offset, so restore works even when preceding rows changed height
 * (e.g. a field expanded, a search filter changed). Filtered lists fall
 * back to the stored pixel offset.
 */

export type BibListPosition = {
  /** Row identity (list `data-entry-id`). */
  entryId: string
  /** Distance of the row top from the viewport top (px, may be <= 0). */
  offset: number
  /** Scroll offset of the list body at capture time. */
  scrollTop: number
}

const BODY_SELECTOR = '.bibtex-entry-list-body'
const ROW_SELECTOR = '.bibtex-entry-card-row'

function bodyOf(list: HTMLElement | null): HTMLElement | null {
  if (!list) return null
  return (
    list.querySelector<HTMLElement>(BODY_SELECTOR) ??
    (list.matches(BODY_SELECTOR) ? list : null)
  )
}

/**
 * Capture the first visible bibliography row without depending on prior row
 * heights. Rows carry `data-entry-id`; lists without row markers yield null.
 */
export function captureBibListPosition(
  list: HTMLElement | null
): BibListPosition | null {
  const body = bodyOf(list)
  if (!body) return null
  const rows = Array.from(
    body.querySelectorAll<HTMLElement>(ROW_SELECTOR)
  )
  if (rows.length === 0) return null
  const viewportTop = body.getBoundingClientRect().top
  let low = 0
  let high = rows.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (rows[middle].getBoundingClientRect().bottom <= viewportTop) {
      low = middle + 1
    } else {
      high = middle
    }
  }
  const row = rows[Math.min(low, rows.length - 1)]
  const entryId = row.dataset.entryId
  if (!entryId) return null
  return {
    entryId,
    offset: viewportTop - row.getBoundingClientRect().top,
    scrollTop: body.scrollTop,
  }
}

/**
 * Restore the same visible row and in-row offset. If the row is absent
 * (filtered list, entry removed), fall back to the saved pixel offset and
 * accept the restoration; do NOT retry an absent row anchor.
 */
export function restoreBibListPosition(
  list: HTMLElement | null,
  position: BibListPosition
): boolean {
  const body = bodyOf(list)
  if (!body) return false
  const row = Array.from(
    body.querySelectorAll<HTMLElement>(ROW_SELECTOR)
  ).find(r => r.dataset.entryId === position.entryId)
  if (!row) {
    body.scrollTop = position.scrollTop
    return true
  }
  const viewportTop = body.getBoundingClientRect().top
  const rowTop = row.getBoundingClientRect().top
  // Relative delta: correct from whatever the current offset is.
  body.scrollTop += rowTop - viewportTop + position.offset
  return true
}
