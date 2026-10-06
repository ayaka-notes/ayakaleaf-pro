/**
 * Displays AI edit proposals as word-level diffs with review and undo actions.
 * Includes line navigation and file-opening controls for locating each change.
 */
import {
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useTranslation } from 'react-i18next'
import { diffWordsWithSpace, type Change } from 'diff'
import type { EditorView } from '@codemirror/view'
import OLButton from '@/shared/components/ol/ol-button'
import MaterialIcon from '@/shared/components/material-icon'
import { useDetachCompileContext } from '@/shared/context/detach-compile-context'
import { useEditorOpenDocContext } from '@/features/ide-react/context/editor-open-doc-context'
import { useEditorManagerContext } from '@/features/ide-react/context/editor-manager-context'
import { useEditorViewContext } from '@/features/ide-react/context/editor-view-context'
import { useFileTreePathContext } from '@/features/file-tree/contexts/file-tree-path'
import { debugConsole } from '@/utils/debugging'
import { sendMB } from '@/infrastructure/event-tracking'
import WorkbenchErrorNotification, { type WorkbenchError } from './error-notification'

const WHITESPACE_ONLY = /^ +$/

/**
 * Word diff with whitespace-only chunks merged into the neighbouring
 * added/removed runs so the rendered diff reads naturally.
 */
export function aggregateDiff(source: string, target: string): Change[] {
  const parts = diffWordsWithSpace(source, target)
  const result: Change[] = []
  let added: Change | null = null
  let removed: Change | null = null

  function pending() {
    return added?.value || removed?.value
  }
  function merge(existing: Change | null, part: Change): Change {
    if (existing) {
      existing.value += part.value
      if (part.count && existing.count) {
        existing.count += part.count
      }
      return existing
    }
    return part
  }
  function pushAdded(part: Change) {
    added = merge(added, part)
  }
  function pushRemoved(part: Change) {
    removed = merge(removed, part)
  }
  function flush() {
    while (pending() && added?.value === removed?.value) {
      const { value, count } = added!
      added = null
      removed = null
      result.push({ value, count } as Change)
    }
    if (removed) {
      result.push(removed)
      removed = null
    }
    if (added) {
      result.push(added)
      added = null
    }
  }

  for (const part of parts) {
    if (part.added) {
      pushAdded(part)
    } else if (part.removed) {
      pushRemoved(part)
    } else if (part.value.match(WHITESPACE_ONLY)) {
      if (pending()) {
        pushAdded({ ...part, added: true })
        pushRemoved({ ...part, removed: true })
      } else {
        result.push(part)
      }
    } else {
      flush()
      result.push(part)
    }
  }
  flush()
  return result
}

/** Sync the PDF preview to a line in the current document. */
function useSyncToLine() {
  const { syncToEntry } = useDetachCompileContext()
  const { currentDocumentId } = useEditorOpenDocContext()
  const { pathInFolder } = useFileTreePathContext()
  return useCallback(
    (line: number, column = 0) => {
      if (currentDocumentId) {
        const file = pathInFolder(currentDocumentId)
        syncToEntry({ file, line, column })
      }
    },
    [currentDocumentId, pathInFolder, syncToEntry]
  )
}

export const CodeDiff = ({
  source,
  target,
  lineStart,
  showDiff,
}: {
  source: string
  target: string
  lineStart: number
  showDiff: boolean
}) => {
  const syncToLine = useSyncToLine()
  return (
    <div className="workbench-code-diff">
      <div className="workbench-code-diff-line-number">
        <button className="btn btn-link btn-sm" onClick={() => syncToLine(lineStart)}>
          {lineStart}
        </button>
      </div>
      {showDiff ? <DiffCode source={source} target={target} /> : <Code>{target}</Code>}
    </div>
  )
}

const DiffCode = memo(function DiffCode({
  source,
  target,
}: {
  source: string
  target: string
}) {
  const parts = aggregateDiff(source, target)
  // Build diff spans as text nodes so source content is not interpreted as HTML.
  const ref = useCallback(
    (element: HTMLElement | null) => {
      if (element) {
        element.replaceChildren()
        for (const part of parts) {
          if (part.added) {
            const ins = document.createElement('ins')
            ins.textContent = part.value
            element.append(ins)
          } else if (part.removed) {
            const del = document.createElement('del')
            del.textContent = part.value
            element.append(del)
          } else {
            element.append(document.createTextNode(part.value))
          }
        }
        return element
      }
    },
    [parts]
  )
  return <Code ref={ref} />
})

const Code = forwardRef<HTMLElement, { children?: ReactNode }>(function Code(
  { children },
  ref
) {
  return (
    <code className="workbench-code-diff-code" ref={ref}>
      {children}
    </code>
  )
})

/** Wait for the target document to attach before editing its contents. */
export function useEnsureCurrentPath() {
  const { currentDocumentId, currentDocument } = useEditorOpenDocContext()
  const { openDoc } = useEditorManagerContext()
  const { view } = useEditorViewContext()
  const { findEntityByPath } = useFileTreePathContext()
  const [notification, setNotification] = useState<WorkbenchError | null>(null)
  const [opening, setOpening] = useState(false)
  const pending = useRef(false)
  const editor = { currentDocumentId, currentDocument, view }
  const editorRef = useRef<typeof editor | null>(editor)
  useEffect(() => {
    editorRef.current = { currentDocumentId, currentDocument, view }
    return () => { editorRef.current = null }
  }, [currentDocumentId, currentDocument, view])
  return {
    notification,
    setNotification,
    opening,
    ensureCurrentPath: useCallback(
      async (path?: string) => {
        if (pending.current) return
        pending.current = true
        setOpening(true)
        setNotification(null)
        try {
          if (!path) {
            throw new Error('The suggested edit is missing a file path.')
          }
          const found = findEntityByPath(path)
          if (!found || found.type !== 'doc') {
            throw new Error('The file for this suggestion could not be found.')
          }
          await openDoc(found.entity as any)
          // openDoc resolves before React attaches the new document to CodeMirror.
          const deadline = Date.now() + 5000
          do {
            await new Promise(resolve => window.setTimeout(resolve, 50))
            const current = editorRef.current
            if (!current) return
            if (current.currentDocumentId !== found.entity._id) {
              throw new Error('The open file changed before the suggestion could be applied.')
            }
            if (
              current.view &&
              current.currentDocument?.doc_id === found.entity._id &&
              current.currentDocument.cm6?.view === current.view
            ) return current.view
          } while (Date.now() < deadline)
          throw new Error('The file is still opening. Try again when it is ready.')
        } catch (error) {
          debugConsole.error(error)
          if (editorRef.current) {
            setNotification(error instanceof Error ? error.message : true)
          }
        } finally {
          pending.current = false
          if (editorRef.current) setOpening(false)
        }
      },
      [findEntityByPath, openDoc]
    ),
  }
}

export const CodeSuggestion = ({
  fromLine,
  existingContent,
  newContent,
  rationale,
  actions,
  notification,
}: {
  fromLine: number
  existingContent: string
  newContent: string
  rationale?: string
  actions: ReactNode
  notification?: WorkbenchError | null
}) => {
  const [showDiff, setShowDiff] = useState(true)
  const toggleDiff = useCallback(() => {
    setShowDiff(showDiff => {
      sendMB('ai-chat-response', {
        button: showDiff ? 'hide-changes' : 'show-changes',
      })
      return !showDiff
    })
  }, [])
  return (
    <div className="workbench-code-suggestion">
      {rationale && <p>{rationale}</p>}
      <CodeDiff
        lineStart={fromLine}
        source={existingContent}
        target={newContent}
        showDiff={showDiff}
      />
      <div className="d-flex justify-content-between align-items-center gap-2 workbench-code-diff-actions">
        <div className="d-flex align-items-center gap-2">
          <OLButton variant="ghost" size="sm" onClick={toggleDiff}>
            {showDiff ? 'Hide changes' : 'Show changes'}
          </OLButton>
        </div>
        <div className="d-flex align-items-center gap-2">{actions}</div>
      </div>
      {notification && <WorkbenchErrorNotification content={notification} />}
    </div>
  )
}

/** Reject / Apply actions while a replace_lines call awaits approval. */
export const SuggestionApproval = ({
  part,
  handleApproval,
}: {
  part: any
  handleApproval: (view: EditorView | null) => void
}) => {
  const { t } = useTranslation()
  const { ensureCurrentPath, notification, opening } = useEnsureCurrentPath()
  if (part.state !== 'input-available') {
    return null
  }
  return (
    <CodeSuggestion
      {...part.input}
      notification={notification}
      actions={
        <>
          <OLButton size="sm" variant="secondary" disabled={opening} onClick={() => handleApproval(null)}>
            {t('reject')}
          </OLButton>
          <OLButton
            size="sm"
            variant="secondary"
            disabled={opening}
            onClick={async () => {
              const targetView = await ensureCurrentPath(part.input.path)
              if (targetView) handleApproval(targetView)
            }}
          >
            {t('apply')} <MaterialIcon type="arrow_right_alt" />
          </OLButton>
        </>
      }
    />
  )
}

/** Undo / re-Apply toggle once a replace_lines call has been applied. */
export const SuggestionUndo = ({
  part,
  handleUndo,
  handleApply,
}: {
  part: any
  handleUndo: (view: EditorView) => void
  handleApply: (view: EditorView) => void
}) => {
  const [undone, setUndone] = useState(false)
  const { t } = useTranslation()
  const { ensureCurrentPath, notification, setNotification, opening } = useEnsureCurrentPath()
  const toggleChange = async () => {
    const targetView = await ensureCurrentPath(part.input.path)
    if (!targetView) return
    try {
      if (undone) {
        handleApply(targetView)
      } else {
        handleUndo(targetView)
      }
      setUndone(!undone)
    } catch (error) {
      debugConsole.error(error)
      setNotification(error instanceof Error ? error.message : true)
    }
  }
  if (part.state !== 'output-available') {
    return null
  }
  return (
    <CodeSuggestion
      {...part.input}
      notification={notification}
      actions={
        <>
          {undone ? (
            <OLButton
              size="sm"
              variant="secondary"
              disabled={opening}
              onClick={toggleChange}
            >
              {t('apply')} <MaterialIcon type="arrow_right_alt" />
            </OLButton>
          ) : (
            <OLButton
              size="sm"
              variant="ghost"
              disabled={opening}
              style={{ border: '1px solid transparent' }}
              onClick={toggleChange}
            >
              <MaterialIcon type="undo" /> {t('undo')}
            </OLButton>
          )}
        </>
      }
    />
  )
}
