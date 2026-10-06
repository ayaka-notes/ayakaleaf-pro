import { useCallback, type MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import classNames from 'classnames'
import OLButton from '@/shared/components/ol/ol-button'
import OLTooltip from '@/shared/components/ol/ol-tooltip'
import MaterialIcon from '@/shared/components/material-icon'
import getMeta from '@/utils/meta'
import useAiAccess from '@modules/workbench/frontend/js/hooks/use-ai-access'
import { useEditorViewContext } from '@/features/ide-react/context/editor-view-context'
import type { SuggestFixLogEntry } from '../hooks/use-suggest-fix'

/**
 * Adds the AI fix action to a compile-log entry header.
 * Opens the log entry and activates its suggest-fix trigger.
 */

// Only warnings and errors are eligible for AI fixes.
const FIXABLE_LEVELS: Record<string, boolean> = {
  raw: false,
  warning: true,
  error: true,
  typesetting: false,
}

export default function SuggestFixButton({
  logEntry,
  id,
}: {
  logEntry?: SuggestFixLogEntry
  id?: string
}) {
  const { t } = useTranslation()
  const { view } = useEditorViewContext()
  const hasAiFeatures = useAiAccess('errorAssistant')
  const disabled = Boolean(getMeta('ol-showAiFeaturesDisabled'))

  const onClick = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    window.dispatchEvent(
      new CustomEvent('editor:view-compile-log-entry', {
        detail: { id },
      })
    )
    // The upstream suggestFix event checks a separate suggestion quota.
    // This module checks AI access here and in its backend middleware.
    event.currentTarget
      .closest('.log-entry')
      ?.querySelector<HTMLButtonElement>('button[data-action="suggest-fix"]')
      ?.click()
  }, [id])

  // Show the action only when AI access and usable error context are available.
  const fixable =
    Boolean(view) &&
    hasAiFeatures &&
    Boolean(
      logEntry?.level && FIXABLE_LEVELS[logEntry.level] && logEntry?.raw
    )

  if (!fixable) {
    return null
  }

  const tooltip = t(
    disabled ? 'ai_features_unavailable_on_this_project' : 'suggest_fix'
  )

  const button = (
    <OLButton
      variant="ghost"
      className="icon-button ai-error-assistant-suggest-fix-button"
      disabled={disabled}
      onClick={onClick}
    >
      <MaterialIcon
        type="auto_awesome"
        className={classNames('ai-error-assistant-sparkle', {
          'opacity-50': disabled,
        })}
        accessibilityLabel={t('suggest_fix')}
      />
    </OLButton>
  )

  return (
    <OLTooltip
      id={`suggest-fix-${id}`}
      description={tooltip}
      overlayProps={{ placement: 'bottom' }}
    >
      {disabled ? <span className="d-inline-block">{button}</span> : button}
    </OLTooltip>
  )
}
