// Extension point wrapper for sourceEditorComponents
// Provides root-level LLM editor features (inline completion, floating toolbar)
import React, { useEffect, useRef, useState } from 'react'
import { useCodeMirrorViewContext } from '@/features/source-editor/components/codemirror-context'
import { useEditorOpenDocContext } from '@/features/ide-react/context/editor-open-doc-context'
import { usePermissionsContext } from '@/features/ide-react/context/permissions-context'
import LLMToolbar, { LLMToolbarHandle } from './llm-toolbar'
import { useLLMFeatures } from '../hooks/use-llm-features'

function LLMSourceEditorComponent() {
    const view = useCodeMirrorViewContext()
    const toolbarRef = useRef<LLMToolbarHandle>(null)
    const [extensionInstalled, setExtensionInstalled] = useState(false)

    // overleaf-lab: publish the chat feature flag on window so the review-tooltip
    // core patch can hide its "Ask AI" entry when chat is disabled. That entry lives
    // in a core component that only knows the module flag (llmEnabled), not the
    // runtime chat toggle; this bridges the runtime flag to it. Defaults to enabled
    // until the flags load, matching the pre-flag behavior.
    const features = useLLMFeatures()
    useEffect(() => {
        ;(window as any).__llmChatEnabled = features.chatEnabled
    }, [features.chatEnabled])

    // Install inline completion extension
    useEffect(() => {
        if (!view || extensionInstalled) return
        try {
            // overleaf-lab: the extension itself registers through the
            // sourceEditorExtensions config entry; here we only flip the
            // installed flag once the view exists.
            view.dispatch({
                effects: (window as any).__cm_llm_reconfigure
                    ? []
                    : // @ts-ignore
                    [],
            })
            setExtensionInstalled(true)
        } catch {
            // Extension may already be active or view not ready
        }
    }, [view, extensionInstalled])

    // overleaf-lab (2026): AI Error Assist "Apply fix" — the log-pane card
    // (outside this context) can't reach the CodeMirror view directly, so it
    // posts a request event; we're inside CodeMirrorViewContext.Provider, so
    // we own the edit: exact-match the suggested text in the open document,
    // dispatch a CM transaction (the realtime OT extension syncs it), and
    // reply. Safe by construction: any mismatch (file changed, wrong doc,
    // pure deletion of something not present) is refused, never fuzzy-applied.
    const { openDocName } = useEditorOpenDocContext()
    const { trackedWrite } = usePermissionsContext()
    useEffect(() => {
        const handleApply = (e: Event) => {
            const detail = (e as CustomEvent).detail || {}
            const reqId = detail.reqId
            if (!reqId || !view) return
            const reply = (ok: boolean, reason?: string, extra?: Record<string, unknown>) => {
                window.dispatchEvent(
                    new CustomEvent('llm-cfx-apply-reply', {
                        detail: { reqId, ok, reason, ...extra }
                    })
                )
            }
            try {
                if (!trackedWrite) {
                    return reply(false, 'read-only')
                }
                const base = (s: string | undefined) =>
                    String(s || '').replace(/^\/?compile\//, '').split('/').pop() || ''
                const target = base(detail.file)
                if (target && openDocName && base(openDocName) !== target) {
                    return reply(false, 'wrong-doc', { openDoc: openDocName })
                }
                const doc = view.state.doc
                const oldText = String(detail.suggestedOld || '')
                const newText = String(detail.suggestedNew || '')
                const span = Array.isArray(detail.span)
                    ? [parseInt(detail.span[0], 10), parseInt(detail.span[1], 10)]
                    : null
                let from = -1
                let to = -1
                if (span && span[0] >= 1 && span[1] >= span[0] && span[1] <= doc.lines) {
                    const fromLine = doc.line(span[0])
                    const toLine = doc.line(span[1])
                    const start = fromLine.from
                    const end = toLine.to
                    const slice = doc.sliceString(start, end)
                    if (oldText) {
                        if (slice === oldText) {
                            from = start
                            to = end
                        }
                        // else: fall through to single-line search below
                    } else {
                        from = end
                        to = end
                    }
                }
                if (from === -1) {
                    const lineNo = Math.max(1, Math.min(detail.line || 1, doc.lines))
                    const line = doc.line(lineNo)
                    if (oldText) {
                        const at = line.text.indexOf(oldText)
                        if (at !== -1) {
                            from = line.from + at
                            to = line.from + at + oldText.length
                        }
                    } else {
                        from = line.to
                        to = line.to
                    }
                }
                // overleaf-lab (2026): the line hint above can be stale (the model
                // re-quotes the text, or the doc shifted after an earlier apply).
                // Fall back to a document-wide exact search first...
                const docText = doc.toString()
                if (from === -1 && oldText) {
                    const at = docText.indexOf(oldText)
                    if (at !== -1) {
                        from = at
                        to = at + oldText.length
                    }
                }
                // ...then a whitespace-tolerant match: collapse whitespace runs in
                // both the suggestion and the document, and map the normalized
                // offset back to the original range. Still content-exact — never
                // fuzzy-applies.
                if (from === -1 && oldText) {
                    const nOld = oldText.replace(/\s+/g, ' ').trim()
                    if (nOld.length > 0) {
                        let normDoc = ''
                        const map: number[] = []
                        let prevWs = true
                        for (let i = 0; i < docText.length; i++) {
                            if (/[\s]/.test(docText[i])) {
                                if (!prevWs) {
                                    normDoc += ' '
                                    map.push(i)
                                }
                            } else {
                                normDoc += docText[i]
                                map.push(i)
                            }
                            prevWs = /[\s]/.test(docText[i])
                        }
                        const atN = normDoc.indexOf(nOld)
                        if (atN !== -1) {
                            from = map[atN]
                            to = map[atN + nOld.length - 1] + 1
                        }
                    }
                }
                if (from === -1 && oldText) {
                    // overleaf-lab (2026): a stale card may re-suggest a fix the
                    // user already applied — detect the NEW text being present and
                    // say so, instead of a confusing "not found" error.
                    if (newText && docText.includes(newText)) {
                        return reply(false, 'already-applied')
                    }
                    return reply(false, 'not-found')
                }
                if (from === to && !newText) {
                    return reply(false, 'not-found')
                }
                view.dispatch({
                    changes: { from, to, insert: newText },
                    selection: { anchor: from + newText.length },
                    scrollIntoView: true
                })
                view.focus()
                reply(true)
            }
            catch (err) {
                reply(false, 'internal', { error: (err as Error).message })
            }
        }
        window.addEventListener('llm-cfx-apply-request', handleApply)
        return () => window.removeEventListener('llm-cfx-apply-request', handleApply)
    }, [view, openDocName, trackedWrite])

    // Listen for "Ask AI" from the review tooltip menu
    useEffect(() => {
        const handleAskAI = (e: Event) => {
            const detail = (e as CustomEvent).detail
            if (!detail?.text || !view || !toolbarRef.current) return
            // overleaf-lab: chat disabled by admin -> do not open the toolbar.
            if (features.chatEnabled === false) return
            toolbarRef.current.show(view)
            // Immediately open the menu panel
            toolbarRef.current.openMenu?.()
        }
        document.addEventListener('llm-ask-ai-selection', handleAskAI)
        return () => document.removeEventListener('llm-ask-ai-selection', handleAskAI)
    }, [view, features.chatEnabled])

    return <LLMToolbar ref={toolbarRef} />
}

export default LLMSourceEditorComponent
