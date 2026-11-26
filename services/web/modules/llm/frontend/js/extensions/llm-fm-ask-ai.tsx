import React from 'react'
import MaterialIcon from '@/shared/components/material-icon'
import { useCodeMirrorStateContext } from '@/features/source-editor/components/codemirror-context'
import { useLLMChat } from '../hooks/use-llm-chat'

/**
 * Editor floating menu (appears when text is selected / cursor focused):
 * "Ask AI" entry point — opens the LLM context panel for the current
 * selection. Mirrors the upstream writing-tools star button.
 *
 * Renders only when a non-empty selection exists and the shared LLM state
 * is ready. (This file is a static slot registered via
 * `editorFloatingMenuActions`; it mounts inside the source editor's
 * React/CodeMirror provider tree.)
 */
function LLMAskAiFloatingMenu() {
    const { hasModels } = useLLMChat()
    const state = useCodeMirrorStateContext()
    const main = state.selection.main
    const selectedText = state.sliceDoc(main.from, main.to)

    if (!hasModels || !selectedText) {
        return null
    }

    const onClick = () => {
        // The LLM toolbar (registered via sourceEditorComponents, same
        // CodeMirror context tree) listens for this event and opens its
        // panel anchored to the current selection.
        document.dispatchEvent(
            new CustomEvent('llm-ask-ai-selection', {
                detail: { text: selectedText },
            })
        )
    }

    return (
        <button
            type="button"
            className="editor-floating-menu-button llm-fm-ask-ai"
            aria-label="Ask AI about this selection"
            onClick={onClick}
        >
            <span aria-hidden="true">
                <MaterialIcon type="smart_toy" />
            </span>
            Ask AI
        </button>
    )
}

export default LLMAskAiFloatingMenu
