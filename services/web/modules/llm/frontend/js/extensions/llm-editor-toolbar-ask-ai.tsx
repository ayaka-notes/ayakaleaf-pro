import React from 'react'
import { useCodeMirrorViewContext } from '@/features/source-editor/components/codemirror-context'

/**
 * overleaf-lab (reference-synced 2026-08): the "Ask AI" button of the editor
 * toolbar — smart_toy, same aria label as the reference product. Clicking it
 * opens the LLM context menu (input + context-sensitive actions) anchored in
 * the IDE, like the reference's editor-toolbar AI entry point.
 *
 * Rendered by the core editor toolbar via the module slot
 * `sourceEditorToolbarStartButtons`, so it lives inside the CodeMirror
 * provider tree (the view can be read from the context).
 */
const LLMEditorToolbarAskAi = React.memo(function LLMEditorToolbarAskAi() {
    const view = useCodeMirrorViewContext()

    // overleaf-lab (owner bug report #6): capture the CURRENT selection at
    // pointer-down — BEFORE the click can blur the editor and collapse the
    // CodeMirror selection — so the menu opened by the click is reliably
    // context-sensitive (selection → transformations, none → generators).
    const capturedRef = React.useRef<
        { text: string; range: { from: number; to: number } } | null
    >(null)

    const onPointerDown = () => {
        const sel = view.state.selection.main
        capturedRef.current = sel.empty
            ? null
            : { text: view.state.sliceDoc(sel.from, sel.to), range: { from: sel.from, to: sel.to } }
    }

    const onClick = () => {
        const detail: Record<string, unknown> = { view }
        const live = view.state.selection.main
        const sel = !live.empty
            ? { text: view.state.sliceDoc(live.from, live.to), range: { from: live.from, to: live.to } }
            : capturedRef.current
        if (sel) {
            detail.text = sel.text
            detail.range = sel.range
        }
        document.dispatchEvent(
            new CustomEvent('ol-llm-open-ask-ai', { detail }),
        )
    }

    return (
        <div className="writefull" data-overflow="main-toolbar-ai-context-menu">
            <button
                type="button"
                className="ol-cm-toolbar-button llm-cm-toolbar-ask-ai"
                aria-label="Get AI assistance for your LaTeX writing and more"
                title="Get AI assistance for your LaTeX writing and more"
                onPointerDown={onPointerDown}
                onClick={onClick}
            >
                <span className="material-symbols" aria-hidden="true" translate="no">
                    smart_toy
                </span>
            </button>
        </div>
    )
})

export default LLMEditorToolbarAskAi
