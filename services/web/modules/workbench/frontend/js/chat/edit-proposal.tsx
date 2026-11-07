/**
 * A propose_edit call as the user reviews it: the reason, the change as a
 * word diff, and Apply/Reject before it is applied, Undo/Apply after.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { EditorView } from '@codemirror/view'
import OLButton from '@/shared/components/ol/ol-button'
import MaterialIcon from '@/shared/components/material-icon'
import { useDetachCompileContext } from '@/shared/context/detach-compile-context'
import { useEditorOpenDocContext } from '@/features/ide-react/context/editor-open-doc-context'
import { useEditorManagerContext } from '@/features/ide-react/context/editor-manager-context'
import { useEditorViewContext } from '@/features/ide-react/context/editor-view-context'
import { useFileTreePathContext } from '@/features/file-tree/contexts/file-tree-path'
import { applyEdit, revertEdit, wordDiff } from '../agent/apply-edit'
import type { Respond } from '../agent/tools'
import { ChatNotice } from './notices'
import { flatGhost, framed, muted, plain, useChangeColors } from './themed'

export type EditPart = {
  toolCallId: string
  state: string
  input: {
    path: string
    startLine: number
    endLine: number
    oldText: string
    newText: string
    reason?: string
  }
}

const OPEN_TIMEOUT_MS = 5000

/** Opens the document at path and resolves with its editor view. */
function useOpenDocument() {
  const { findEntityByPath } = useFileTreePathContext()
  const { openDoc } = useEditorManagerContext()
  const { currentDocument } = useEditorOpenDocContext()
  const { view } = useEditorViewContext()
  const live = useRef({ currentDocument, view })
  useEffect(() => {
    live.current = { currentDocument, view }
  }, [currentDocument, view])

  return useCallback(
    async (path: string): Promise<EditorView> => {
      const found = findEntityByPath(path)
      if (found?.type !== 'doc') {
        throw new Error(`${path} is not a document of this project.`)
      }
      await openDoc(found.entity as any)
      // openDoc returns before the editor shows the document
      const until = Date.now() + OPEN_TIMEOUT_MS
      while (Date.now() < until) {
        const { currentDocument, view } = live.current
        if (view && currentDocument?.doc_id === found.entity._id && currentDocument.cm6?.view === view) {
          return view
        }
        await new Promise(resolve => window.setTimeout(resolve, 50))
      }
      throw new Error(`${path} did not open in time; try again.`)
    },
    [findEntityByPath, openDoc]
  )
}

function DiffText({ before, after }: { before: string; after: string }) {
  const { added, removed } = useChangeColors()
  const parts = useMemo(() => wordDiff(before, after), [before, after])
  return (
    <code className="flex-grow-1 text-break" style={{ ...plain, whiteSpace: 'pre-wrap', fontSize: '1em' }}>
      {parts.map((part, index) =>
        part.added ? (
          <ins key={index} style={added}>
            {part.value}
          </ins>
        ) : part.removed ? (
          <del key={index} style={removed}>
            {part.value}
          </del>
        ) : (
          part.value
        )
      )}
    </code>
  )
}

export default function EditProposal({ part, respond }: { part: EditPart; respond: Respond }) {
  const { t } = useTranslation()
  const { input } = part
  const openDocument = useOpenDocument()
  const { syncToEntry } = useDetachCompileContext()
  const [showDiff, setShowDiff] = useState(true)
  const [reverted, setReverted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const pending = part.state === 'input-available'
  const settled = part.state === 'output-available'

  const answer = (outcome: { output: string } | { errorText: string }) =>
    respond(
      'output' in outcome
        ? { tool: 'propose_edit', toolCallId: part.toolCallId, output: outcome.output }
        : { tool: 'propose_edit', toolCallId: part.toolCallId, state: 'output-error', errorText: outcome.errorText }
    )

  // A document that does not open is shown here and can be retried; an edit
  // that no longer fits goes back to the model
  const inDocument = async (action: (view: EditorView) => void) => {
    setBusy(true)
    setProblem(null)
    try {
      action(await openDocument(input.path))
    } catch (error) {
      setProblem(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  const apply = () =>
    inDocument(view => {
      try {
        applyEdit(view, input)
      } catch (error) {
        answer({ errorText: error instanceof Error ? error.message : String(error) })
        return
      }
      answer({ output: 'Edit applied.' })
    })

  const toggleApplied = () =>
    inDocument(view => {
      if (reverted) applyEdit(view, input)
      else revertEdit(view, input)
      setReverted(!reverted)
    })

  if (!pending && !settled) return null

  return (
    <div className="d-flex flex-column gap-2 py-2">
      {input.reason && <p className="mb-0">{input.reason}</p>}
      <div
        className="d-flex gap-3 rounded p-2"
        style={{ ...framed, backgroundColor: 'var(--bg-primary-themed)', fontSize: 'var(--font-size-01)' }}
      >
        <button
          type="button"
          className="btn btn-link btn-sm p-0 align-self-start text-decoration-none"
          style={{ ...muted, fontSize: 'inherit' }}
          title="Show this line in the PDF"
          onClick={() => syncToEntry({ file: input.path, line: input.startLine, column: 0 })}
        >
          {input.startLine}
        </button>
        {showDiff ? (
          <DiffText before={input.oldText} after={input.newText} />
        ) : (
          <code className="flex-grow-1 text-break" style={{ ...plain, whiteSpace: 'pre-wrap', fontSize: '1em' }}>
            {input.newText}
          </code>
        )}
      </div>
      {/* The actions wrap below the toggle in a narrow panel */}
      <div className="d-flex flex-wrap align-items-center gap-2">
        <OLButton variant="ghost" size="sm" style={flatGhost} onClick={() => setShowDiff(!showDiff)}>
          {showDiff ? 'Show result' : 'Show diff'}
        </OLButton>
        <div className="d-flex gap-2 ms-auto">
        {pending && (
          <>
            <OLButton
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => answer({ errorText: 'The user declined this edit.' })}
            >
              {t('reject')}
            </OLButton>
            <OLButton variant="secondary" size="sm" disabled={busy} onClick={apply}>
              {t('apply')} <MaterialIcon type="arrow_right_alt" />
            </OLButton>
          </>
        )}
        {settled &&
          (reverted ? (
            <OLButton variant="secondary" size="sm" disabled={busy} onClick={toggleApplied}>
              {t('apply')} <MaterialIcon type="arrow_right_alt" />
            </OLButton>
          ) : (
            <OLButton variant="ghost" size="sm" style={flatGhost} disabled={busy} onClick={toggleApplied}>
              <MaterialIcon type="undo" /> {t('undo')}
            </OLButton>
          ))}
        </div>
      </div>
      {problem && <ChatNotice type="error" text={problem} />}
    </div>
  )
}
