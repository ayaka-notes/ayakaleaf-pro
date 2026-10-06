import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { EditorView } from '@codemirror/view'
import { ErrorAssistantMessage } from './error-assistant-message'
import type { PreviousFix } from '../extensions/previous-fix'

// Keep the end of long paths visible in the log entry heading.
function truncatePath(path = '', max = 16): string {
  if (path.length <= max) return path
  return '…' + path.slice(-(max - 1))
}

/**
 * Displays the saved explanation and suggested changes in the
 * "Last suggested fix" log entry, including actions for unapplied changes.
 */
export function PreviousFixContent({
  previousFix,
  view,
}: {
  previousFix: PreviousFix
  view: EditorView
}) {
  const { t } = useTranslation()

  const firstSuggestion = useMemo(() => {
    for (const message of previousFix.messages) {
      if (message.suggestions?.length) {
        return message.suggestions[0]
      }
    }
    return undefined
  }, [previousFix])

  return (
    <div className="ai-error-assistant ai-error-assistant-finished">
      <div className="ai-error-assistant-meta">
        <div className="ai-error-assistant-heading">
          {firstSuggestion
            ? t('suggested_fix_for_error_in_path', {
                path: truncatePath(firstSuggestion.path),
              })
            : t('last_suggested_fix')}
        </div>
      </div>
      <div className="ai-error-assistant-messages">
        {previousFix.messages.map(
          (message, index) =>
            message.role === 'assistant' && (
              <ErrorAssistantMessage
                key={index}
                message={message}
                view={view}
                onApplied={() => {}}
              />
            )
        )}
      </div>
    </div>
  )
}
