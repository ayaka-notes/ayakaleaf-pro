import { FC, memo, useCallback } from 'react'
import OutlinePane from '@/features/outline/components/outline-pane'
import CommentOutlinePane from '@/features/outline/components/comment-outline-pane'
import { useOutlineContext } from '@/features/ide-react/context/outline-context'
import useNestedOutline from '../hooks/use-nested-outline'

export const OutlineContainer: FC = memo(() => {
  const {
    highlightedLine,
    canShowOutline,
    jumpToLine,
    outlineExpanded,
    toggleOutlineExpanded,
    commentHighlights,
  } = useOutlineContext()

  const handleToggle = useCallback((isOpen: boolean) => {
    window.dispatchEvent(new CustomEvent('outline-toggled', { detail: isOpen }))
  }, [])

  const outline = useNestedOutline()

  return (
    <div className="outline-container">
      <OutlinePane
        outline={outline.items}
        onToggle={handleToggle}
        isTexFile={canShowOutline}
        jumpToLine={jumpToLine}
        highlightedLine={highlightedLine}
        isPartial={outline.partial}
        expanded={outlineExpanded}
        toggleExpanded={toggleOutlineExpanded}
      />
      <CommentOutlinePane
        entries={commentHighlights}
        jumpToLine={jumpToLine}
      />
    </div>
  )
})
OutlineContainer.displayName = 'OutlineContainer'
