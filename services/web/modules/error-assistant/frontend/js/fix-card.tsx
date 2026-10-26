/**
 * One proposed fix: the lines before and after as a word diff, copy, and
 * apply. A fix for another file first opens that file; a fix whose lines
 * have changed since cannot be applied, one whose lines moved still can.
 */
import { useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { EditorView } from '@codemirror/view'
import OLButton from '@/shared/components/ol/ol-button'
import OLTooltip from '@/shared/components/ol/ol-tooltip'
import MaterialIcon from '@/shared/components/material-icon'
import { CopyToClipboard } from '@/shared/components/copy-to-clipboard'
import { useDetachCompileContext } from '@/shared/context/detach-compile-context'
import { useEditorOpenDocContext } from '@/features/ide-react/context/editor-open-doc-context'
import { useFileTreePathContext } from '@/features/file-tree/contexts/file-tree-path'
import sparkle from '@/shared/svgs/sparkle.svg'
import { applyEdit, findEdit, wordDiff } from '@modules/workbench/frontend/js/agent/apply-edit'
import type { Fix } from './use-fix-request'
import { boxed, muted, plain, surface } from '@modules/workbench/frontend/js/chat/themed'

// The old text on light red, the fix on light green, dark text on both
const REMOVED = { backgroundColor: 'var(--bg-danger-01)', color: 'var(--content-primary-dark)' }
const ADDED = { backgroundColor: 'var(--bg-accent-01)', color: 'var(--content-primary-dark)', textDecoration: 'none' }

function DiffRow({
  sign,
  line,
  onLine,
  divided = false,
  children,
}: {
  sign: string
  line: number
  onLine: () => void
  divided?: boolean
  children: React.ReactNode
}) {
  return (
    <div
      className="d-flex align-items-start gap-2 px-2 py-1 fw-medium"
      style={{
        fontSize: 'var(--font-size-01)',
        ...(divided && { borderBottom: '1px solid var(--border-divider-themed)' }),
      }}
    >
      <MaterialIcon type={sign} style={muted} />
      <button type="button" className="btn btn-link btn-sm p-0 text-reset text-decoration-none" style={{ fontSize: 'inherit' }} onClick={onLine}>
        {line}
      </button>
      <code className="flex-grow-1 text-break" style={{ ...plain, whiteSpace: 'pre-wrap', fontSize: '1em' }}>
        {children}
      </code>
    </div>
  )
}

export default function FixCard({
  fix,
  view,
  onApplied,
  recompileAfter,
}: {
  fix: Fix
  view: EditorView | null
  onApplied: () => void
  recompileAfter: boolean
}) {
  const { t } = useTranslation()
  const copyId = useId()
  const { syncToEntry, startCompile, compiling } = useDetachCompileContext()
  const { currentDocumentId } = useEditorOpenDocContext()
  const { pathInFolder } = useFileTreePathContext()
  const [, refresh] = useState(0)
  const parts = useMemo(() => wordDiff(fix.oldText, fix.newText), [fix])

  const openPath = currentDocumentId ? pathInFolder(currentDocumentId) : null
  const fileIsOpen = openPath === fix.path
  const target = view && fileIsOpen ? findEdit(view, fix) : null
  const goToLine = (open = false) =>
    syncToEntry({ file: fix.path, line: fix.startLine, column: 0 }, open)

  const apply = () => {
    if (!fileIsOpen) {
      goToLine(true)
      return
    }
    // Read again: the document may have changed since this render
    if (!view || findEdit(view, fix) === null) {
      refresh(n => n + 1)
      return
    }
    applyEdit(view, fix)
    onApplied()
    refresh(n => n + 1)
    if (recompileAfter) window.setTimeout(startCompile, 500)
  }

  const stale = fileIsOpen && target === null
  const button = (
    <OLButton variant="secondary" size="sm" disabled={compiling || stale} onClick={apply}>
      {fileIsOpen ? t('apply_suggestion') : t('open_path', { path: fix.path })}
    </OLButton>
  )

  return (
    <li className="d-flex flex-column gap-2">
      <div className="rounded overflow-hidden" style={boxed} data-fix-card="">
        <div
          className="d-flex align-items-center gap-2 px-2 py-1"
          style={{ ...surface, borderBottom: '1px solid var(--border-divider-themed)', fontSize: 'var(--font-size-01)' }}
        >
          <img src={sparkle} width={16} height={16} alt="" aria-hidden="true" />
          <span className="flex-grow-1 fw-medium">{t('suggested_code')}</span>
          <CopyToClipboard content={fix.newText} tooltipId={copyId} kind="icon" />
        </div>
        <DiffRow sign="remove" line={fix.startLine} onLine={() => goToLine()} divided>
          {parts.map((part, index) =>
            part.added ? null : part.removed ? (
              <del key={index} style={REMOVED}>
                {part.value}
              </del>
            ) : (
              part.value
            )
          )}
        </DiffRow>
        <DiffRow sign="add" line={fix.startLine} onLine={() => goToLine()}>
          {parts.map((part, index) =>
            part.removed ? null : part.added ? (
              <ins key={index} style={ADDED}>
                {part.value}
              </ins>
            ) : (
              part.value
            )
          )}
        </DiffRow>
      </div>
      <div className="d-flex justify-content-end">
        {stale ? (
          <OLTooltip id={`${copyId}-stale`} description={t('the_original_text_has_changed')}>
            <span>{button}</span>
          </OLTooltip>
        ) : (
          button
        )}
      </div>
    </li>
  )
}
