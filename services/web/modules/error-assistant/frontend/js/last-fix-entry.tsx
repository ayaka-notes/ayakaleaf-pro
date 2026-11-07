/**
 * The last proposed fix as its own log entry (pdfLogEntriesComponents), so
 * it is still at hand when applying it triggered a new compile.
 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import PdfLogEntry from '@/features/pdf-preview/components/pdf-log-entry'
import { useEditorViewContext } from '@/features/ide-react/context/editor-view-context'
import { useDetachCompileContext } from '@/shared/context/detach-compile-context'
import useAiAccess from '@modules/workbench/frontend/js/hooks/use-ai-access'
import { lastFixField } from './last-fix-store'
import { FixList } from './fix-panel'

export default function LastFixEntry() {
  const { t } = useTranslation()
  const { view } = useEditorViewContext()
  const { compiling, syncToEntry } = useDetachCompileContext()
  const hasAccess = useAiAccess('errorAssistant')
  const read = () => view?.state.field(lastFixField, false) ?? null
  const [lastFix, setLastFix] = useState(read)

  // The field is read when a compile ends; the log is rebuilt then anyway
  useEffect(() => {
    if (!compiling) setLastFix(read())
  }, [compiling, view]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!view || !lastFix || !hasAccess) return null

  const { entry } = lastFix
  return (
    <PdfLogEntry
      id="last-ai-fix"
      headerTitle={t('last_suggested_fix')}
      entryAriaLabel={t('last_suggested_fix')}
      level={(entry.level as any) ?? 'error'}
      sourceLocation={{ file: entry.file, line: entry.line, column: entry.column } as any}
      onSourceLocationClick={syncToEntry}
      formattedContent={
        <div className="d-flex flex-column gap-2">
          <FixList explanation={lastFix.explanation} fixes={lastFix.fixes} view={view} onApplied={() => {}} />
        </div>
      }
    />
  )
}
