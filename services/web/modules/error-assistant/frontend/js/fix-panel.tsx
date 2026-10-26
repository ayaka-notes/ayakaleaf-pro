/**
 * The assistant inside a compile log entry (pdfLogEntryComponents). The core
 * starts it by clicking button[data-action="suggest-fix"] in the entry, which
 * the header button here also does.
 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { EditorView } from '@codemirror/view'
import OLButton from '@/shared/components/ol/ol-button'
import OLIconButton from '@/shared/components/ol/ol-icon-button'
import OLTooltip from '@/shared/components/ol/ol-tooltip'
import OLNotification from '@/shared/components/notification'
import getMeta from '@/utils/meta'
import useAiConsent from '@/shared/hooks/use-ai-consent'
import { useEditorViewContext } from '@/features/ide-react/context/editor-view-context'
import { useFileTreePathContext } from '@/features/file-tree/contexts/file-tree-path'
import sparkle from '@/shared/svgs/sparkle.svg'
import useAiAccess from '@modules/workbench/frontend/js/hooks/use-ai-access'
import Markdown from '@modules/workbench/frontend/js/chat/markdown'
import { useFixRequest, type Fix, type FixEntry } from './use-fix-request'
import { setLastFix } from './last-fix-store'
import FixCard from './fix-card'
import { boxed, muted, plain } from '@modules/workbench/frontend/js/chat/themed'

/** Errors and warnings in project documents can be fixed, not TeX's own files. */
export function useCanFix(entry?: FixEntry) {
  const { view } = useEditorViewContext()
  const { findEntityByPath } = useFileTreePathContext()
  const hasAccess = useAiAccess('errorAssistant')
  return Boolean(
    view &&
      hasAccess &&
      entry?.raw &&
      (entry.level === 'error' || entry.level === 'warning') &&
      entry.file &&
      findEntityByPath(entry.file)?.type === 'doc'
  )
}

export function FixList({
  explanation,
  fixes,
  view,
  onApplied,
}: {
  explanation: string
  fixes: Fix[]
  view: EditorView | null
  onApplied: () => void
}) {
  return (
    <>
      {explanation.trim() && <Markdown text={explanation} />}
      {fixes.length > 0 && (
        <ul className="list-unstyled mb-0 d-flex flex-column gap-2">
          {fixes.map((fix, index) => (
            <FixCard
              fix={fix}
              view={view}
              onApplied={onApplied}
              recompileAfter={fixes.length === 1}
              key={index}
            />
          ))}
        </ul>
      )}
    </>
  )
}

function Sparkle() {
  return <img src={sparkle} width={20} height={20} alt="" aria-hidden="true" />
}

function RetryButton({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation()
  return (
    <OLTooltip id="fix-retry" description={t('suggest_a_different_fix')}>
      <OLIconButton
        icon="refresh"
        variant="ghost"
        size="sm"
        accessibilityLabel={t('suggest_a_different_fix')}
        onClick={onRetry}
      />
    </OLTooltip>
  )
}

export default function FixPanel({ logEntry }: { logEntry: FixEntry }) {
  const { t } = useTranslation()
  const canFix = useCanFix(logEntry)
  const aiOffHere = getMeta('ol-showAiFeaturesDisabled')
  const { hasGivenAiConsent, giveAiConsent } = useAiConsent()
  const { view } = useEditorViewContext()
  const { explanation, fixes, status, request } = useFixRequest(logEntry)
  const [started, setStarted] = useState(false)
  const [applied, setApplied] = useState(false)

  const start = () => {
    setStarted(true)
    setApplied(false)
    if (hasGivenAiConsent) request()
  }

  // A finished answer becomes the "last suggested fix" after a recompile
  useEffect(() => {
    if (status === 'done' && view && (explanation || fixes.length)) {
      view.dispatch({ effects: setLastFix.of({ entry: logEntry, explanation, fixes, applied: false }) })
    }
  }, [status]) // eslint-disable-line react-hooks/exhaustive-deps

  const markApplied = () => {
    setApplied(true)
    view?.dispatch({ effects: setLastFix.of({ entry: logEntry, explanation, fixes, applied: true }) })
  }

  if (!canFix || aiOffHere) return null

  const trigger = (
    <button type="button" className="d-none" data-action="suggest-fix" onClick={start} />
  )

  if (started && !hasGivenAiConsent) {
    return (
      <section
        className="rounded p-3 d-flex flex-column gap-2 mt-2"
        style={{ ...boxed, ...plain, fontSize: 'var(--font-size-02)' }}
        aria-label={t('suggest_fix')}
      >
        <div className="d-flex align-items-center gap-2">
          <Sparkle /> {t('before_you_use_error_assistant')}
        </div>
        <OLButton
          variant="primary"
          size="sm"
          className="align-self-end"
          onClick={async () => {
            await giveAiConsent()
            request()
          }}
        >
          {t('accept_and_continue')}
        </OLButton>
      </section>
    )
  }

  const heading =
    status === 'running'
      ? t('finding_a_fix')
      : fixes.length
        ? t('suggested_fix_for_error_in_path', { path: fixes[0].path })
        : null

  return (
    <>
      {trigger}
      {started && (
        <div
          className="rounded p-2 mt-2 d-flex flex-column gap-2"
          // A gradient outline: the panel's background over the gradient,
          // which shows through a transparent border
          style={{
            ...plain,
            border: '1px solid transparent',
            background:
              'linear-gradient(var(--bg-primary-themed), var(--bg-primary-themed)) padding-box, var(--premium-gradient-themed) border-box',
            fontSize: 'var(--font-size-02)',
          }}
          data-fix-panel=""
        >
          <div className="d-flex align-items-center gap-2">
            <Sparkle />
            {heading}
            {status === 'running' && <span className="spinner-border spinner-border-sm" aria-hidden="true" />}
          </div>
          {(status === 'failed' || status === 'quota') && (
            <OLNotification
              type="error"
              content={
                status === 'quota'
                  ? t('usage_limit_reached')
                  : t('sorry_it_looks_like_that_didnt_work_this_time')
              }
            />
          )}
          <FixList explanation={explanation} fixes={fixes} view={view} onApplied={markApplied} />
          {status === 'done' && (
            <div
              className="d-flex align-items-center justify-content-between"
              style={{ ...muted, fontSize: 'var(--font-size-01)' }}
            >
              <span>{applied ? t('suggestion_applied') : t('ai_can_make_mistakes')}</span>
              <RetryButton onRetry={start} />
            </div>
          )}
        </div>
      )}
    </>
  )
}
