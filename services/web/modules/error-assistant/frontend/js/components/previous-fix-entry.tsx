import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import PdfLogEntry from '@/features/pdf-preview/components/pdf-log-entry'
import { useEditorViewContext } from '@/features/ide-react/context/editor-view-context'
import { useDetachCompileContext } from '@/shared/context/detach-compile-context'
import useAiAccess from '@modules/workbench/frontend/js/hooks/use-ai-access'
import { previousFixState } from '../extensions/previous-fix'
import { PreviousFixContent } from './previous-fix-content'

/**
 * Displays the last AI fix as a persistent compile-log entry.
 * Reads the saved editor state after each compile so the suggestion remains
 * available when applying a fix replaces the current compile logs.
 */
export default function PreviousFixEntry() {
  const { t } = useTranslation()
  const { view } = useEditorViewContext()
  const { compiling, syncToEntry } = useDetachCompileContext()
  const hasAiFeatures = useAiAccess('errorAssistant')

  const [previousFix, setPreviousFix] = useState(
    () => view?.state.field(previousFixState, false) ?? null
  )

  // Re-read the stored fix whenever a compile settles.
  useEffect(() => {
    if (!compiling) {
      setPreviousFix(view?.state.field(previousFixState, false) ?? null)
    }
  }, [compiling, view?.state])

  const sourceLocation = useMemo(
    () =>
      previousFix
        ? {
            file: previousFix.logEntry.file,
            line: previousFix.logEntry.line,
            column: previousFix.logEntry.column,
          }
        : undefined,
    [previousFix]
  )

  if (!view || !previousFix || !hasAiFeatures) {
    return null
  }

  return (
    <div className="ai-error-assistant-previous-fix-entry">
      <PdfLogEntry
        id="previous-fix"
        headerTitle={t('last_suggested_fix')}
        formattedContent={
          <PreviousFixContent previousFix={previousFix} view={view} />
        }
        level={(previousFix.logEntry.level as any) || 'error'}
        entryAriaLabel={t('last_suggested_fix')}
        sourceLocation={sourceLocation as any}
        onSourceLocationClick={syncToEntry}
      />
    </div>
  )
}
