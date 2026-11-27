/**
 * Simple windowing (virtualization) for the compact entry list (C3).
 *
 * Rows are absolutely positioned at fixed HEIGHT inside a scroll viewport
 * (capture: `position: absolute; top: …; data-index`). `visibleWindow`
 * computes which rows are in view plus overscan; the list renders top
 * spacer + window rows + bottom spacer.
 *
 * Pure math is unit-tested (C3 gate) — the list component is a thin view
 * over it.
 */

export type WindowMath = {
  start: number
  end: number
  offsetY: number
}

export function visibleWindow(
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  rowCount: number,
  overscan = 4
): WindowMath {
  if (rowCount === 0 || viewportHeight <= 0 || rowHeight <= 0) {
    return { start: 0, end: 0, offsetY: 0 }
  }
  const first = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan)
  const visible = Math.ceil(viewportHeight / rowHeight)
  // clamp: a window beyond the end still ends at the last row (overscan
  // may push `start` back into view, but never negative or past the end)
  const start = Math.max(0, Math.min(first, rowCount - visible - overscan))
  const last = Math.min(rowCount, start + visible + overscan)
  return {
    start,
    end: last,
    offsetY: start * rowHeight,
  }
}

export function listContentHeight(
  rowCount: number,
  rowHeight: number
): number {
  return rowCount * rowHeight
}

export function spacerHeights(
  rowCount: number,
  rowHeight: number,
  window: WindowMath
): { top: number; bottom: number } {
  const content = listContentHeight(rowCount, rowHeight)
  const windowPx = (window.end - window.start) * rowHeight
  return { top: window.offsetY, bottom: Math.max(0, content - window.offsetY - windowPx) }
}
