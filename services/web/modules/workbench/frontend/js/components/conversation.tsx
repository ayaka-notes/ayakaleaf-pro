/**
 * Keeps streamed chat messages in view while the user follows the conversation.
 * Provides a scroll-to-bottom button when the user scrolls away.
 */
import { useCallback, useId, type ComponentProps } from 'react'
import classNames from 'classnames'
import { StickToBottom, useStickToBottomContext } from 'use-stick-to-bottom'
import OLIconButton from '@/shared/components/ol/ol-icon-button'
import OLTooltip from '@/shared/components/ol/ol-tooltip'

export const Conversation = ({
  className,
  ...props
}: ComponentProps<typeof StickToBottom>) => (
  <StickToBottom
    className={classNames('conversation', className)}
    initial="smooth"
    resize="smooth"
    role="log"
    {...props}
  />
)

export const ConversationContent = ({
  className,
  ...props
}: ComponentProps<typeof StickToBottom.Content>) => (
  <StickToBottom.Content
    className={classNames('p-2 d-flex gap-2 flex-column conversation-content', className)}
    {...props}
  />
)

export const ConversationScrollButton = () => {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext()
  const handleScrollToBottom = useCallback(() => {
    scrollToBottom()
  }, [scrollToBottom])
  const tooltipId = useId()

  if (isAtBottom) {
    return null
  }

  return (
    <OLTooltip id={tooltipId} description="Scroll to bottom">
      <OLIconButton
        className="conversation-scroll-to-bottom"
        icon="arrow_downward"
        onClick={handleScrollToBottom}
        variant="secondary"
      />
    </OLTooltip>
  )
}
