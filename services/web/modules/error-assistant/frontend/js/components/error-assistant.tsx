import '../error-assistant.css'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import classNames from 'classnames'
import OLButton from '@/shared/components/ol/ol-button'
import OLTooltip from '@/shared/components/ol/ol-tooltip'
import OLIconButton from '@/shared/components/ol/ol-icon-button'
import Notification from '@/shared/components/notification'
import MaterialIcon from '@/shared/components/material-icon'
import getMeta from '@/utils/meta'
import { sendMB } from '@/infrastructure/event-tracking'
import useAiAccess from '@modules/workbench/frontend/js/hooks/use-ai-access'
import useAiConsent from '@/shared/hooks/use-ai-consent'
import { useEditorViewContext } from '@/features/ide-react/context/editor-view-context'
import { useSuggestFix, type SuggestFixLogEntry } from '../hooks/use-suggest-fix'
import { ErrorAssistantMessage } from './error-assistant-message'
import { previousFixEffect } from '../extensions/previous-fix'
import sparkleUrl from '../images/ai-error-assistant-sparkle.svg'

// Only warnings and errors are eligible for AI fixes.
const FIXABLE_LEVELS: Record<string, boolean> = {
  raw: false,
  warning: true,
  error: true,
  typesetting: false,
}

/**
 * Displays AI fix suggestions within a compile-log entry.
 * The hidden suggest-fix trigger connects the log header action to this panel.
 * Suggestions and their applied state are saved in the
 * editor so they remain available after recompiling.
 */
export default function ErrorAssistant({
  logEntry,
}: {
  logEntry: SuggestFixLogEntry
}) {
  const { t } = useTranslation()
  const hasAiFeatures = useAiAccess('errorAssistant')
  const showAiFeaturesDisabled = getMeta('ol-showAiFeaturesDisabled')
  const { hasGivenAiConsent, giveAiConsent } = useAiConsent()
  const { view } = useEditorViewContext()
  const [triggered, setTriggered] = useState(false)
  const [applied, setApplied] = useState(false)
  const { messages, heading, running, finished, error, rating, setRating, suggestFix } =
    useSuggestFix(logEntry)

  const start = useCallback(() => {
    setTriggered(true)
    if (hasGivenAiConsent) {
      setApplied(false)
      suggestFix()
    }
  }, [hasGivenAiConsent, suggestFix])

  const acceptConsent = useCallback(async () => {
    try {
      await giveAiConsent()
    } finally {
      suggestFix()
    }
  }, [giveAiConsent, suggestFix])

  const retry = useCallback(() => {
    setApplied(false)
    suggestFix()
  }, [suggestFix])

  const handleApplied = useCallback(() => {
    setApplied(true)
    // Persist the applied fix into editor state so it survives the recompile
    // and re-renders as the "Last suggested fix" entry.
    if (view) {
      view.dispatch({
        effects: previousFixEffect.of({ messages, logEntry, applied: true }),
      })
    }
    sendMB('ai-error-assistant', { action: 'apply-suggestion' })
  }, [view, messages, logEntry])

  // When a fix session finishes, store it in editor state
  // so it persists as the "Last suggested fix" entry across recompiles.
  useEffect(() => {
    if (finished && view && messages.length > 0) {
      view.dispatch({
        effects: previousFixEffect.of({ messages, logEntry, applied: false }),
      })
    }
  }, [finished, view, messages, logEntry])

  const rate = useCallback(
    (value: number) => {
      setRating(rating === value ? 0 : value)
      sendMB('ai-error-assistant', { action: 'rate', rating: value })
    },
    [rating, setRating]
  )

  // Fixable entries only (warning/error), and only when AI features are enabled.
  if (
    !logEntry.level ||
    !FIXABLE_LEVELS[logEntry.level] ||
    !hasAiFeatures ||
    showAiFeaturesDisabled
  ) {
    return null
  }

  // One-time consent gate (shares the workbench consent tutorial key).
  if (triggered && !hasGivenAiConsent) {
    return (
      <div
        className="ai-error-assistant ai-error-assistant-intro"
        role="region"
        aria-label="AI error assistant"
      >
        <div className="ai-error-assistant-header">
          <img
            width="20"
            height="20"
            alt="sparkle"
            className="ai-error-assistant-sparkle"
            src={sparkleUrl}
            aria-hidden="true"
          />
          <div className="ai-error-assistant-meta">
            <div className="ai-error-assistant-heading">
              {t('before_you_use_error_assistant')}
            </div>
          </div>
        </div>
        <div className="ai-error-assistant-footer">
          <OLButton variant="primary" size="sm" onClick={acceptConsent}>
            {t('accept_and_continue')}
          </OLButton>
        </div>
      </div>
    )
  }

  // The log header activates this trigger even while the entry is collapsed.
  return (
    <>
      <button
        type="button"
        className="ai-error-assistant-hidden-suggest-fix-button"
        data-action="suggest-fix"
        onClick={start}
      />
      {(triggered || messages.length > 0) && (
        <div
          className={classNames('ai-error-assistant', {
            'ai-error-assistant-running': running,
            'ai-error-assistant-finished': finished,
          })}
        >
          <div className="ai-error-assistant-header">
            <img
              width="20"
              height="20"
              alt="sparkle"
              className="ai-error-assistant-sparkle"
              src={sparkleUrl}
              aria-hidden="true"
            />
            {heading && (
              <div className="ai-error-assistant-meta">
                <div className="ai-error-assistant-heading">{heading}</div>
              </div>
            )}
          </div>

          {(error || messages.length > 0) && (
            <div className="ai-error-assistant-messages">
              {error && (
                <div className="notification-list">
                  <Notification
                    type="error"
                    content={
                      error === 'paywalled'
                        ? t('usage_limit_reached')
                        : t('sorry_it_looks_like_that_didnt_work_this_time')
                    }
                  />
                </div>
              )}
              {messages.map((message, index) => (
                <ErrorAssistantMessage
                  key={index}
                  message={message}
                  view={view}
                  onApplied={handleApplied}
                />
              ))}
              {running && <span className="ai-error-assistant-cursor" />}
            </div>
          )}

          <div className="ai-error-assistant-footer">
            {finished && <div>{t('ai_can_make_mistakes')}</div>}
            <div className="ai-error-assistant-footer-inner">
              {finished ? (
                <div className="ai-error-assistant-feedback">
                  <OLTooltip
                    id="ai-error-assistant-feedback-positive-tooltip"
                    description={t('this_was_helpful')}
                  >
                    <OLIconButton
                      accessibilityLabel={t('this_was_helpful')}
                      onClick={() => rate(1)}
                      className={classNames(
                        'ai-error-assistant-feedback-button',
                        'ai-error-assistant-feedback-positive',
                        { active: rating === 1 }
                      )}
                      icon="thumb_up"
                      unfilled={rating !== 1}
                      variant="ghost"
                      size="sm"
                    />
                  </OLTooltip>
                  <OLTooltip
                    id="ai-error-assistant-feedback-negative-tooltip"
                    description={t('this_wasnt_helpful')}
                  >
                    <OLIconButton
                      accessibilityLabel={t('this_wasnt_helpful')}
                      onClick={() => rate(-1)}
                      className={classNames(
                        'ai-error-assistant-feedback-button',
                        'ai-error-assistant-feedback-negative',
                        { active: rating === -1 }
                      )}
                      icon="thumb_down"
                      unfilled={rating !== -1}
                      variant="ghost"
                      size="sm"
                    />
                  </OLTooltip>
                  <OLTooltip
                    id="ai-error-assistant-feedback-retry-tooltip"
                    description={t('suggest_a_different_fix')}
                  >
                    <OLButton
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={t('suggest_a_different_fix')}
                      onClick={retry}
                      className="ai-error-assistant-feedback-button"
                    >
                      <MaterialIcon type="refresh" />
                    </OLButton>
                  </OLTooltip>
                </div>
              ) : (
                <span />
              )}
              {applied && <div>{t('suggestion_applied')}</div>}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
