import { FC, useCallback, useEffect, useState } from 'react'
import useEventListener from '@/shared/hooks/use-event-listener'
import getMeta from '@/utils/meta'
import {
  useCodeMirrorViewContext,
} from '@/features/source-editor/components/codemirror-context'
import {
  mathAncestorNode,
  parseMathContainer,
} from '@/features/source-editor/utils/tree-operations/math'
import { descendantsOfNodeWithType } from '@/features/source-editor/utils/tree-operations/ancestors'
import EquationEditorPortal from './equation-editor-portal'

type OpenDetail = {
  latex?: string
  from?: number
  to?: number
}

const equationEditorAvailable = getMeta('ol-latexEditorAvailable')

/**
 * Headless controller that owns the Equation Editor state (open/closed,
 * initial content, replace range) and listens for the 'latex-editor:open'
 * event — dispatched both by the toolbar button and by the math preview
 * tooltip ("Open in Equation Editor").
 *
 * It is registered via `sourceEditorToolbarComponents`, which the source
 * editor renders unconditionally, so it stays mounted in the
 * writefull-toolbar-migration cohort too, where the toolbar end button
 * (latex-editor-toolbar-button) is not rendered. Without this, the
 * tooltip action would dispatch the event with no listener.
 *
 * CM access is via CodeMirrorViewContext, so import/insert always target
 * the main editor view.
 */
const LatexEditorController: FC = () => {
  const view = useCodeMirrorViewContext()

  const [open, setOpen] = useState(false)
  const [initialLatex, setInitialLatex] = useState<string | undefined>(
    undefined
  )
  // Document range of the equation we opened ("Open in Equation Editor");
  // when set, the original equation is selected so Export replaces it.
  const [replaceRange, setReplaceRange] = useState<{
    from: number
    to: number
  } | null>(null)

  const handleInsert = useCallback(
    (latex: string) => {
      const { from, to } = view.state.selection.main
      view.dispatch({
        changes: { from, to, insert: latex },
        selection: { anchor: from + latex.length },
      })
      view.focus()
    },
    [view]
  )

  const handleImport = useCallback((): string => {
    const state = view.state
    const main = state.selection.main
    if (!main.empty) {
      // A range is selected: import it raw — the modal splits it into
      // body + environment (wrapLatex can then reproduce it)
      return state.sliceDoc(main.from, main.to)
    }
    // Empty selection: import the equation under the cursor (same math
    // container extraction the math preview tooltip uses)
    const ancestorNode = mathAncestorNode(state, main.from)
    if (ancestorNode) {
      const [node] = descendantsOfNodeWithType(ancestorNode, 'Math', 'Math')
      if (node) {
        const mathContainer = parseMathContainer(state, node, ancestorNode)
        if (mathContainer) {
          return mathContainer.content
        }
      }
    }
    return ''
  }, [view])

  const handleOpenWithLatex = useCallback((event: Event) => {
    const detail = ((event as CustomEvent<OpenDetail>).detail ||
      {}) as OpenDetail
    setInitialLatex(detail.latex || undefined)
    setReplaceRange(
      typeof detail.from === 'number' &&
        typeof detail.to === 'number' &&
        detail.to > detail.from
        ? { from: detail.from, to: detail.to }
        : null
    )
    setOpen(true)
  }, [])

  const handleClose = useCallback(() => {
    setOpen(false)
    setInitialLatex(undefined)
    setReplaceRange(null)
  }, [])

  // "Open in Equation Editor" (math preview tooltip) and the toolbar
  // button both dispatch this event
  useEventListener('latex-editor:open', (event: Event) =>
    handleOpenWithLatex(event)
  )

  // Mark the original equation in the document: select its range once the
  // editor is open, so Export (insert-at-selection) replaces it exactly.
  useEffect(() => {
    if (!open || !replaceRange) return
    try {
      const { from, to } = replaceRange
      if (from >= 0 && to > from && to <= view.state.doc.length) {
        view.dispatch({ selection: { anchor: from, head: to } })
      }
    } catch {
      // stale range (document changed): leave the selection as-is
    }
  }, [open, replaceRange, view])

  if (!equationEditorAvailable || !open) {
    return null
  }

  return (
    <EquationEditorPortal
      onInsert={handleInsert}
      onImport={handleImport}
      onClose={handleClose}
      initialLatex={initialLatex}
    />
  )
}

export default LatexEditorController
