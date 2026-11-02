import { describe, it, expect } from 'vitest'
import {
  visibleWindow,
  listContentHeight,
  spacerHeights,
} from '../../../frontend/js/utils/virtual-list.ts'

/**
 * C3 (PHASE_C_PLAN.md §3): window math for the compact virtualized list.
 * Rows are absolutely positioned at a fixed height (capture: `position:
 * absolute; … data-index`); `visibleWindow` computes the in-view range
 * plus overscan, and the list renders top spacer + window + bottom spacer.
 */

describe('C3: virtual-list window math', () => {
  it('empty list → empty window', () => {
    expect(visibleWindow(100, 400, 47, 0)).toEqual({
      start: 0,
      end: 0,
      offsetY: 0,
    })
  })

  it('degenerate dims → empty window', () => {
    expect(visibleWindow(100, 0, 47, 10)).toEqual({ start: 0, end: 0, offsetY: 0 })
    expect(visibleWindow(100, 400, 0, 10)).toEqual({ start: 0, end: 0, offsetY: 0 })
  })

  it('scrolls clamped at both ends', () => {
    // overscan never pushes the window beyond the row range
    const w1 = visibleWindow(999999, 400, 47, 10)
    expect(w1.start).toBeLessThanOrEqual(9)
    expect(w1.end).toBeLessThanOrEqual(10)
    const w0 = visibleWindow(0, 400, 47, 10)
    expect(w0.start).toBe(0)
  })

  it('a window at the top starts at 0 and covers viewport + overscan', () => {
    // scrollTop=0 → first=max(0, 0-overscan)=0; end=min(count, visible+overscan)
    const w = visibleWindow(0, 470, 47, 100, 4)
    expect(w.start).toBe(0)
    const visible = Math.ceil(470 / 47) // 10
    expect(w.end).toBe(Math.min(100, visible + 4))
    expect(w.offsetY).toBe(0)
  })

  it('offsetY = start * rowHeight always', () => {
    for (const scrollTop of [0, 23, 141, 357, 5000]) {
      const w = visibleWindow(scrollTop, 300, 47, 50)
      expect(w.offsetY).toBe(w.start * 47)
    }
  })

  it('spacers: top = offsetY, bottom = content − window, ≥0', () => {
    const w = visibleWindow(141, 300, 47, 50)
    const s = spacerHeights(50, 47, w)
    expect(s.top).toBe(w.offsetY)
    expect(s.bottom).toBeGreaterThanOrEqual(0)
    // total = content height exactly
    expect(s.top + s.bottom).toBe(
      listContentHeight(50, 47) - (w.end - w.start) * 47
    )
  })

  it('content height is linear in row count', () => {
    expect(listContentHeight(0, 47)).toBe(0)
    expect(listContentHeight(3, 47)).toBe(141)
  })
})
