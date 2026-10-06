/**
 * Displays collapsible model reasoning with streaming status and elapsed time.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import classNames from 'classnames'
import MaterialIcon from '@/shared/components/material-icon'
import { Response } from './response'

function useThinkingDuration() {
  const [duration, setDuration] = useState(0)
  const startedAt = useRef<number | null>(null)
  return {
    duration,
    start: useCallback(() => {
      if (startedAt.current === null) {
        startedAt.current = Date.now()
      }
    }, []),
    stop: useCallback(() => {
      if (startedAt.current !== null) {
        const now = Date.now()
        setDuration(now - startedAt.current)
        startedAt.current = null
      }
    }, []),
  }
}

export const Reasoning = ({
  isStreaming,
  markdown,
}: {
  isStreaming: boolean
  markdown: string
}) => {
  const [expanded, setExpanded] = useState(false)
  const { duration, start, stop } = useThinkingDuration()

  useEffect(() => {
    if (isStreaming) {
      start()
    } else {
      stop()
    }
  }, [isStreaming, start, stop])

  const toggle = useCallback(() => {
    setExpanded(expanded => !expanded)
  }, [])

  return (
    <div className={classNames('reasoning', { 'is-streaming': isStreaming })}>
      <button className="reasoning-toggle" onClick={toggle}>
        <ReasoningLabel
          duration={duration}
          isStreaming={isStreaming}
          isExpanded={expanded}
          showToggle={Boolean(markdown && markdown.length > 0)}
        />
      </button>
      <div
        className={classNames('reasoning-content', {
          'reasoning-collapsed': !expanded,
        })}
      >
        <Response markdown={markdown} />
      </div>
    </div>
  )
}

const ReasoningLabel = ({
  duration,
  isStreaming,
  isExpanded,
  showToggle,
}: {
  duration: number
  isStreaming: boolean
  isExpanded: boolean
  showToggle: boolean
}) => {
  const seconds = Math.ceil(duration / 1000)
  return (
    <div className={classNames('reasoning-label', { 'reasoning-shimmer': isStreaming })}>
      <MaterialIcon type="lightbulb_2" unfilled />
      <span className="mx-1 reasoning-label-text">
        {isStreaming ? 'Thinking...' : `Thought for ${seconds}s`}
      </span>
      {showToggle ? (
        <MaterialIcon
          type="expand_more"
          style={{
            transform: isExpanded ? 'rotate(0deg)' : 'rotate(-90deg)',
            transition: 'transform 0.2s ease',
          }}
        />
      ) : null}
    </div>
  )
}
