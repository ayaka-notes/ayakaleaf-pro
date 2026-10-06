import { memo, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import OLButton from '@/shared/components/ol/ol-button'
import OLTooltip from '@/shared/components/ol/ol-tooltip'
import MaterialIcon from '@/shared/components/material-icon'
import { useDetachCompileContext } from '@/shared/context/detach-compile-context'
import { aggregateDiff } from '@modules/workbench/frontend/js/components/code-diff'
import sparkleUrl from '../images/ai-error-assistant-sparkle.svg'
import type { Suggestion } from '../hooks/use-suggest-fix'

/**
 * Displays suggested LaTeX changes as word-level diffs, with copy and apply
 * actions. Clickable line numbers synchronize the editor and PDF preview.
 */

/** Copy-to-clipboard button in the header. */
const CopySuggestionButton = ({ content }: { content: string }) => {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true)
      window.setTimeout(() => {
        setCopied(false)
      }, 1500)
    })
  }, [content])
  if (!navigator.clipboard?.writeText) {
    return null
  }
  return (
    <OLTooltip
      id="ai-error-assistant-copy-tooltip"
      description={copied ? t('copied') : t('copy')}
      overlayProps={{ placement: 'bottom' }}
    >
      <OLButton
        variant="ghost"
        size="sm"
        className="icon-button ai-error-assistant-copy-code-btn"
        onClick={handleCopy}
        aria-label={t('copy')}
      >
        <MaterialIcon type={copied ? 'check' : 'content_copy'} />
      </OLButton>
    </OLTooltip>
  )
}

/** Render one side of the word-diff into a code cell. */
const DiffCell = memo(function DiffCell({
  source,
  target,
  side,
}: {
  source: string
  target: string
  side: 'from' | 'to'
}) {
  const ref = useCallback(
    (element: HTMLElement | null) => {
      if (element) {
        element.replaceChildren()
        for (const part of aggregateDiff(source, target)) {
          if (part.added) {
            if (side === 'to') {
              const ins = document.createElement('ins')
              ins.textContent = part.value
              element.append(ins)
            }
          } else if (part.removed) {
            if (side === 'from') {
              const del = document.createElement('del')
              del.textContent = part.value
              element.append(del)
            }
          } else {
            element.append(document.createTextNode(part.value))
          }
        }
      }
    },
    [source, target, side]
  )
  return <div className="ai-error-assistant-code" ref={ref} />
})

export const SuggestedChange = memo(function SuggestedChange({
  suggestion,
  showActions,
}: {
  suggestion: Suggestion
  showActions: boolean
}) {
  const { t } = useTranslation()
  const { syncToEntry } = useDetachCompileContext()

  // Clicking a line number jumps to the change location.
  const handleLineClick = useCallback(() => {
    syncToEntry({
      file: suggestion.path,
      line: suggestion.from.line,
      column: 0,
    })
  }, [suggestion, syncToEntry])

  return (
    <div className="ai-error-assistant-suggested-change">
      <div className="ai-error-assistant-suggested-change-header">
        <img
          width="20"
          height="20"
          alt="sparkle"
          className="ai-error-assistant-sparkle"
          src={sparkleUrl}
          aria-hidden="true"
        />
        <div className="ai-error-assistant-suggested-change-heading">
          {t('suggested_code')}
        </div>
        {showActions && <CopySuggestionButton content={suggestion.to.content} />}
      </div>
      <div className="ai-error-assistant-from">
        <MaterialIcon className="ai-error-assistant-change-icon" type="remove" />
        <div className="ai-error-assistant-line-number">
          <button onClick={handleLineClick}>{suggestion.from.line}</button>
        </div>
        <DiffCell
          source={suggestion.from.content}
          target={suggestion.to.content}
          side="from"
        />
      </div>
      <div className="ai-error-assistant-to">
        <MaterialIcon className="ai-error-assistant-change-icon" type="add" />
        <div className="ai-error-assistant-line-number">
          <button onClick={handleLineClick}>{suggestion.from.line}</button>
        </div>
        <DiffCell
          source={suggestion.from.content}
          target={suggestion.to.content}
          side="to"
        />
      </div>
    </div>
  )
})

/** The Apply / Open-file action button. */
export const ApplySuggestionButton = ({
  applySuggestion,
  pathMatches,
  contentMatchesExpected,
  compiling = false,
  children,
}: {
  applySuggestion: () => void
  pathMatches: boolean
  contentMatchesExpected: boolean
  compiling?: boolean
  children: React.ReactNode
}) => {
  const { t } = useTranslation()
  const button = (
    <OLButton
      className="ai-error-assistant-action-button"
      variant="secondary"
      disabled={compiling || (pathMatches && !contentMatchesExpected)}
      onClick={applySuggestion}
      size="sm"
    >
      {children}
    </OLButton>
  )
  // Explain why a suggestion is disabled when its source content has changed.
  if (!pathMatches || contentMatchesExpected || compiling) {
    return button
  }
  return (
    <OLTooltip
      description={t('the_original_text_has_changed')}
      id="ai-error-assistant-cannot-apply-tooltip"
    >
      <span>{button}</span>
    </OLTooltip>
  )
}
