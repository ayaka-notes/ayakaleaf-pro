// overleaf-lab (2026-11, owner request): the user's EDITOR-SCOPED LLM
// preferences. Today: the inline "ghost text" completion toggle — per user,
// stored on the profile (GET/POST /user/llm/prefs), applied immediately to the
// live editor plugin (setInlineCompletionEnabled) and enforced server-side
// (the /completion endpoint returns empty data when it is off).
import React, { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getJSON, postJSON } from '@/infrastructure/fetch-json'
import MaterialIcon from '@/shared/components/material-icon'
import { setInlineCompletionEnabled } from './llm-completion'

export default function LLMEditorSettings() {
    const { t } = useTranslation()
    // null = not loaded yet (indeterminate)
    const [on, setOn] = useState<boolean | null>(null)
    const [busy, setBusy] = useState(false)

    useEffect(() => {
        let cancelled = false
        getJSON('/user/llm/prefs')
            .then((d: any) => {
                if (!cancelled) setOn(d?.completionEnabled !== false)
            })
            .catch(() => {
                if (!cancelled) setOn(null) // offline: keep the default (on)
            })
        return () => {
            cancelled = true
        }
    }, [])

    const toggle = useCallback(async (next: boolean) => {
        setOn(next)
        // overleaf-lab: apply immediately to the editor in this tab (the plugin
        // checks this flag on every trigger).
        setInlineCompletionEnabled(next)
        setBusy(true)
        try {
            await postJSON('/user/llm/prefs', { body: { completionEnabled: next } })
        }
        catch {
            // Server write failed — the local flag still applies in this tab;
            // the profile will simply keep its old value until the next save.
        }
        finally {
            setBusy(false)
        }
    }, [])

    return (
        <div className="llm-editor-settings">
            <label className="llm-editor-settings-row">
                <input
                    type="checkbox"
                    checked={on !== false}
                    disabled={on === null || busy}
                    onChange={e => void toggle(e.target.checked)}
                />
                <span>
                    <MaterialIcon type="code" className="me-1"  />
                    {t('llm_editor_inline_completion', 'Inline completion (ghost text in the editor)')}
                </span>
            </label>
            <p className="llm-editor-settings-hint">
                {t(
                    'llm_editor_inline_completion_hint',
                    'While you type in the source editor, the rest of the line is suggested as ghost text after a short pause. Accept with Tab (or Ctrl/Cmd+Enter), dismiss by continuing to type or pressing Escape. Manual trigger: Ctrl/Cmd+\\.'
                )}
            </p>
        </div>
    )
}
