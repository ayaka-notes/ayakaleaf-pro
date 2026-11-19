import { CSSProperties, useCallback, useEffect, useState } from 'react'
import { useCodeMirrorViewContext } from '@/features/source-editor/components/codemirror-context'

export const useReviewPanelStyles = () => {
  const view = useCodeMirrorViewContext()

  const [styles, setStyles] = useState<CSSProperties>({} as CSSProperties)

  const updateScrollDomVariables = useCallback((element: HTMLDivElement) => {
    const { top } = element.getBoundingClientRect()
    // Use the scroll DOM's height (visible area) for the panel height,
    // not the content DOM's height (full content), so the panel background
    // fills the visible editor area without scrolling out of view.
    const height = element.clientHeight

    setStyles(value => ({
      ...value,
      '--review-panel-top': `${top}px`,
      '--review-panel-height': `${height}px`,
    }))
  }, [])

  useEffect(() => {
    if ('ResizeObserver' in window) {
      const scrollDomObserver = new window.ResizeObserver(entries =>
        updateScrollDomVariables(entries[0]?.target as HTMLDivElement)
      )
      scrollDomObserver.observe(view.scrollDOM)

      return () => {
        scrollDomObserver.disconnect()
      }
    }
  }, [view, updateScrollDomVariables])

  return styles
}
