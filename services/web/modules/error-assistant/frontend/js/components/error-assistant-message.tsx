import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { EditorView } from '@codemirror/view'
import type { EditorState } from '@codemirror/state'
import { useEditorOpenDocContext } from '@/features/ide-react/context/editor-open-doc-context'
import { useFileTreePathContext } from '@/features/file-tree/contexts/file-tree-path'
import { useDetachCompileContext } from '@/shared/context/detach-compile-context'
import { debugConsole } from '@/utils/debugging'
import { Response } from '@modules/workbench/frontend/js/components/response'
import { highlightChange } from '@modules/workbench/frontend/js/tools/client-tools'
import { SuggestedChange, ApplySuggestionButton } from './suggested-change'
import type { AssistantMessage, Suggestion } from '../hooks/use-suggest-fix'

// Keep the end of long paths visible in the "Open <path>" button.
function truncatePath(path = '', max = 16): string {
  if (path.length <= max) return path
  return '…' + path.slice(-(max - 1))
}

/**
 * Reads the document lines covered by a suggestion, returning undefined when
 * the range falls outside the document.
 */
function getSpanText(state: EditorState, suggestion: Suggestion) {
  const { from } = suggestion
  const endLine = from.line + from.content.split('\n').length - 1
  if (from.line > 0 && endLine <= state.doc.lines) {
    const range = {
      from: state.doc.line(from.line),
      to: state.doc.line(endLine),
    }
    return state.sliceDoc(range.from.from, range.to.to)
  }
}

/**
 * Displays one suggested change and its action button.
 * Checks the current document against the expected content before applying
 * the edit. Changes targeting another file first open that file; a single
 * suggestion triggers a recompile after application.
 */
function SuggestionItem({
  suggestion,
  suggestionCount,
  view,
  onApplied,
}: {
  suggestion: Suggestion
  suggestionCount: number
  view: EditorView | null
  onApplied: () => void
}) {
  const { t } = useTranslation()
  const { syncToEntry, compiling, startCompile } = useDetachCompileContext()
  const { currentDocumentId } = useEditorOpenDocContext()
  const { pathInFolder } = useFileTreePathContext()
  // bump to re-evaluate contentMatchesExpected after we apply
  const [, setAppliedTick] = useState(0)

  const currentPath = useMemo(
    () => (currentDocumentId ? pathInFolder(currentDocumentId) : null),
    [currentDocumentId, pathInFolder]
  )

  const normalizedPath = suggestion.path?.replace(/^\.\//, '')
  const pathMatches =
    !normalizedPath || (currentPath ? currentPath === normalizedPath : true)

  const spanText =
    view && pathMatches ? getSpanText(view.state, suggestion) : undefined
  const contentMatchesExpected = Boolean(
    pathMatches && spanText === suggestion.from.content
  )

  const applySuggestion = useCallback(() => {
    if (!view) return
    try {
      const { from, to } = suggestion
      const endLineNumber = from.line + from.content.split('\n').length - 1

      // Jump the editor to the change location (opens the file when the
      // suggestion targets one that isn't currently open).
      syncToEntry({ file: suggestion.path, line: from.line, column: 0 }, true)

      if (!pathMatches) {
        return
      }

      // The source may have changed since the suggestion was rendered.
      if (getSpanText(view.state, suggestion) !== from.content) {
        setAppliedTick(tick => tick + 1)
        return
      }

      const { doc } = view.state
      if (from.line > 0 && endLineNumber <= doc.lines) {
        const range = {
          from: doc.line(from.line),
          to: doc.line(endLineNumber),
        }

        // Replace the suggested line range.
        view.dispatch({
          changes: {
            from: range.from.from,
            to: range.to.to,
            insert: to.content,
          },
        })
        highlightChange(
          view,
          range.from.from,
          range.from.from + to.content.length
        )
        setAppliedTick(tick => tick + 1)
        onApplied()

        // Recompile automatically when there is only one suggested change.
        if (suggestionCount === 1) {
          window.setTimeout(() => {
            startCompile()
          }, 500)
        }
      }
    } catch (err) {
      debugConsole.error(err)
      setAppliedTick(tick => tick + 1)
    }
  }, [
    view,
    suggestion,
    pathMatches,
    suggestionCount,
    syncToEntry,
    startCompile,
    onApplied,
  ])

  return (
    <li>
      <SuggestedChange suggestion={suggestion} showActions={Boolean(view)} />
      <div className="ai-error-assistant-actions">
        <ApplySuggestionButton
          applySuggestion={applySuggestion}
          pathMatches={pathMatches}
          contentMatchesExpected={contentMatchesExpected}
          compiling={compiling}
        >
          {pathMatches
            ? t('apply_suggestion')
            : t('open_path', { path: truncatePath(normalizedPath, 16) })}
        </ApplySuggestionButton>
      </div>
    </li>
  )
}

/**
 * Displays the streamed explanation and each suggested change separately,
 * since a fix may affect multiple line ranges.
 */
export function ErrorAssistantMessage({
  message,
  view,
  onApplied,
}: {
  message: AssistantMessage
  view: EditorView | null
  onApplied: () => void
}) {
  const suggestions = message.suggestions || []

  return (
    <div className="ai-error-assistant-message">
      {message.content?.trim() && (
        <div className="ai-error-assistant-output">
          <Response markdown={message.content} />
        </div>
      )}
      {suggestions.length > 0 && (
        <ul className="ai-error-assistant-tool-calls">
          {suggestions.map((suggestion, index) => (
            <SuggestionItem
              key={index}
              suggestion={suggestion}
              suggestionCount={suggestions.length}
              view={view}
              onApplied={onApplied}
            />
          ))}
        </ul>
      )}
    </div>
  )
}
