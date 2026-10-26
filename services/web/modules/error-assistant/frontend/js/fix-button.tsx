/**
 * The "Suggest fix" button in a log entry header
 * (pdfLogEntryHeaderActionComponents). It opens the entry and clicks the
 * entry's suggest-fix trigger rendered by FixPanel.
 */
import type { MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import OLIconButton from '@/shared/components/ol/ol-icon-button'
import OLTooltip from '@/shared/components/ol/ol-tooltip'
import getMeta from '@/utils/meta'
import { useCanFix } from './fix-panel'
import type { FixEntry } from './use-fix-request'

export default function FixButton({ logEntry, id }: { logEntry?: FixEntry; id?: string }) {
  const { t } = useTranslation()
  const canFix = useCanFix(logEntry)
  const aiOffHere = Boolean(getMeta('ol-showAiFeaturesDisabled'))
  if (!canFix) return null

  const onClick = (event: MouseEvent<HTMLButtonElement>) => {
    window.dispatchEvent(new CustomEvent('editor:view-compile-log-entry', { detail: { id } }))
    event.currentTarget
      .closest('.log-entry')
      ?.querySelector<HTMLButtonElement>('button[data-action="suggest-fix"]')
      ?.click()
  }

  const label = aiOffHere ? t('ai_features_unavailable_on_this_project') : t('suggest_fix')
  const button = (
    <OLIconButton
      icon="auto_awesome"
      variant="ghost"
      size="sm"
      accessibilityLabel={t('suggest_fix')}
      disabled={aiOffHere}
      onClick={onClick}
    />
  )
  return (
    <OLTooltip id={`fix-button-${id}`} description={label} overlayProps={{ placement: 'bottom' }}>
      {aiOffHere ? <span className="d-inline-block">{button}</span> : button}
    </OLTooltip>
  )
}
