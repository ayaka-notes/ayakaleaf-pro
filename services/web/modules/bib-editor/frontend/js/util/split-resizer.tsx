/**
 * Shared column resizer for the bibtex list/preview split (R9 item 2,
 * 2026-08-29) — project panel AND /library behave identically.
 *
 * Mechanism: the preview slide-out width and the list's `margin-right`
 * shift both read the `--bibtex-split-preview-width` CSS custom property
 * (default 30rem). Dragging the 6 px gutter handle between the list and
 * the preview sets that property on the nearest layout root
 * (`.bib-editor-panel` / `.library-page-main`) and persists the ratio
 * per page in localStorage.
 *
 * Constraints: 25 %–75 % of the layout width (25–75 ratio of the
 * preview), 5 % keyboard steps (ArrowLeft widens the preview, ArrowRight
 * narrows; Home/End are the extremes), no page-scroll side effects
 * (drag captured with pointer events, `pointermove` on window).
 */
import React, { useCallback, useRef, useState } from 'react'
import customLocalStorage from '@/infrastructure/local-storage'

const MIN_RATIO = 0.25
const MAX_RATIO = 0.75
const STEP_RATIO = 0.05
const DEFAULT_RATIO = 0.357 // ≈30rem at the canonical 840px layout

const clampRatio = (r: number) =>
  Math.min(MAX_RATIO, Math.max(MIN_RATIO, Math.round(r * 1000) / 1000))

function readStored(key: string): number {
  const v = customLocalStorage.getItem(key)
  const n = typeof v === 'number' ? v : Number.parseFloat(String(v ?? ''))
  return Number.isFinite(n) ? clampRatio(n) : DEFAULT_RATIO
}

function layoutRootOf(el: Element | null): Element | null {
  if (!el) return null
  return (
    el.closest('.bib-editor-panel') ||
    el.closest('.library-page-main') ||
    el.closest('.bibtex-list-and-preview')
  )
}

function applyRatio (root: Element | null, ratio: number) {
  // The width is expressed as a percentage of the layout width so the
  // rule works at any container size.
  ;(root as HTMLElement | null)?.style?.setProperty('--bibtex-split-preview-width', `${(ratio * 100).toFixed(2)}%`)
}

export function SplitResizer ({ storageKey }: { storageKey?: string }) {
  const key = storageKey || 'bibtex-resizer'
  const ref = useRef<HTMLDivElement | null>(null)
  const [ratio, setRatio] = useState<number>(() =>
    typeof window === 'undefined' ? DEFAULT_RATIO : readStored(key)
  )
  const dragging = useRef(false)
  const liveRatio = useRef(ratio)

  const commit = useCallback(
    (next: number) => {
      const r = clampRatio(next)
      liveRatio.current = r
      setRatio(r)
      applyRatio(layoutRootOf(ref.current), r)
      customLocalStorage.setItem(key, r)
    },
    [key]
  )

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.preventDefault()
      dragging.current = true
      const root = layoutRootOf(ref.current)
      if (!root) return
      // R12-11 (2026-08-31): during the drag, write the CSS custom property
      // DIRECTLY (no React re-render, no localStorage churn per move) — the
      // library's resizer always felt smoother because it did exactly this;
      // the state + storage commit happens once, on release.
      let lastRatio = liveRatio.current
      const update = (clientX: number) => {
        const rect = root.getBoundingClientRect()
        if (rect.width <= 0) return
        lastRatio = clampRatio((rect.right - clientX) / rect.width)
        ;(root as HTMLElement).style.setProperty('--bibtex-split-preview-width', `${(lastRatio * 100).toFixed(2)}%`)
      }
      update(e.clientX)
      const onMove = (ev: PointerEvent) => {
        if (!dragging.current) return
        ev.preventDefault()
        update(ev.clientX)
      }
      const onUp = () => {
        dragging.current = false
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        commit(lastRatio)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
      if (ref.current) ref.current.focus({ preventScroll: true })
    },
    [commit]
  )

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        commit(ratio + STEP_RATIO) // divider left → preview wider
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        commit(ratio - STEP_RATIO)
      } else if (e.key === 'Home') {
        e.preventDefault()
        commit(MIN_RATIO)
      } else if (e.key === 'End') {
        e.preventDefault()
        commit(MAX_RATIO)
      } else {
        return
      }
    },
    [ratio, commit]
  )

  // The resizer is intentionally interactive: it is exposed as an ARIA
  // slider (aria-valuenow/min/max + keyboard control) — the canonical
  // pattern for a resizable column divider.
  return (
    <div
      ref={ref}
      className="bibtex-preview-resizer"
      role="slider"
      aria-orientation="vertical"
      aria-label="Resize bibliography column"
      aria-valuemin={Math.round(MIN_RATIO * 100)}
      aria-valuemax={Math.round(MAX_RATIO * 100)}
      aria-valuenow={Math.round(ratio * 100)}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
    />
  )
}

export default SplitResizer
