// overleaf-lab (2026): AI Error Assist result card — rendered INSIDE the
// compile log entry (pdfLogEntryComponents hook). Upstream-style:
// heading → explanation → "Suggested code" (from/to, line numbers, del/ins,
// Copy) → "Suggest a different fix" → disclaimer footer.
// No helpfulness feedback buttons (owner decision, 2026-08).
import React, { useEffect, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import MaterialIcon from '@/shared/components/material-icon'
import {
    getCompileFixStatus,
    subscribeCompileFix,
    requestCompileFix,
    LLM_COMPILE_FIX_EVENT,
    type LogEntryLike
} from '../utils/llm-compile-fix-store'
import '../../stylesheets/llm-ui.scss'

interface Props {
    logEntry?: LogEntryLike
}

// (core also passes `index`; the card doesn't need it — intentionally
// not declared so the prop isn't dead.)

const escapeHtml = (s: string) =>
    String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')

// Rebuild the from/to rows from the result (the backend returns the numbered
// snippet; we recover the unmodified line and highlight old→new inside it).
function renderSuggestedLines(result: {
    line: number
    startLine: number
    snippet: string
    suggestedOld: string
    suggestedNew: string
    span?: [number, number]
}): { fromHtml: string; toHtml: string; lineFrom: number; lineTo: number } {
    const lines = (result.snippet || '')
        .split('\n')
        .map(l => l.replace(/^[>  ]*\d+: ?/, ''))
    const idx = Math.max(0, (result.line || 1) - (result.startLine || 1))
    const current = lines[idx] ?? ''
    const old = result.suggestedOld ?? ''
    const fresh = result.suggestedNew ?? ''
    const lineFrom = result.span ? result.span[0] : result.line
    const lineTo = result.span ? result.span[1] : result.line
    let fromHtml: string
    let toHtml: string
    if (old) {
        const at = current.indexOf(old)
        if (at >= 0) {
            fromHtml =
                escapeHtml(current.slice(0, at)) +
                `<del>${escapeHtml(old)}</del>` +
                escapeHtml(current.slice(at + old.length))
            toHtml =
                escapeHtml(current.slice(0, at)) +
                `<ins>${escapeHtml(fresh)}</ins>` +
                escapeHtml(current.slice(at + old.length))
        }
        else {
            fromHtml = `<del>${escapeHtml(current || old)}</del>`
            toHtml = `<ins>${escapeHtml(fresh)}</ins>`
        }
    }
    else {
        // pure insertion
        fromHtml = `<del></del>`
        toHtml = `<ins>${escapeHtml(fresh)}</ins>`
    }
    return { fromHtml, toHtml, lineFrom, lineTo }
}

function PdfLlmCompileFixCard({ logEntry }: Props) {
    const { t } = useTranslation()
    const [status, setStatus] = useState(() =>
        logEntry ? getCompileFixStatus(logEntry) : { status: 'idle' as const }
    )
    const [copied, setCopied] = useState(false)
    // Apply state: idle → pending → applied, or a failure reason.
    const [applyState, setApplyState] = useState<
        { kind: 'idle' } | { kind: 'pending' } | { kind: 'applied' }
        | { kind: 'failed'; reason: string; openDoc?: string }
    >({ kind: 'idle' })

    // Keep the card in sync with the store (button triggers, re-runs).
    useEffect(() => {
        const update = () => setStatus(logEntry ? getCompileFixStatus(logEntry) : { status: 'idle' })
        update()
        const off = subscribeCompileFix(update)
        const onEvent = () => update()
        window.addEventListener(LLM_COMPILE_FIX_EVENT, onEvent)
        return () => {
            off()
            window.removeEventListener(LLM_COMPILE_FIX_EVENT, onEvent)
        }
    }, [logEntry])

    useEffect(() => {
        setCopied(false)
        setApplyState({ kind: 'idle' })
    }, [status])

    const copy = useCallback(async () => {
        if (status.status !== 'result') return
        const text = status.result.suggestedNew
        try {
            await navigator.clipboard.writeText(text)
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
        }
        catch {
            // Clipboard blocked (permissions/headless) — select nothing,
            // the text stays visible in the card.
        }
    }, [status])

    const differentFix = useCallback(() => {
        if (!logEntry) return
        const prev =
            status.status === 'result'
                ? {
                      old: status.result.suggestedOld,
                      new: status.result.suggestedNew
                  }
                : null
        void requestCompileFix(logEntry, prev)
    }, [logEntry, status])

    // overleaf-lab (2026): "Apply fix" — dispatch to the editor-scoped bridge
    // (llm-source-editor-component) which performs the exact-match edit. Only
    // valid for the current result; refused (not fuzzy-applied) if the text
    // is gone, the doc is wrong, or the user is read-only.
    const apply = useCallback(async () => {
        if (status.status !== 'result') return
        const reqId = `cfx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        setApplyState({ kind: 'pending' })
        const result = status.result
        await new Promise<void>((resolve) => {
            const timer = setTimeout(() => {
                window.removeEventListener('llm-cfx-apply-reply', onReply)
                setApplyState({ kind: 'failed', reason: 'timeout' })
                resolve()
            }, 8000)
            const onReply = (ev: Event) => {
                const d = ((ev as CustomEvent).detail || {}) as {
                    reqId?: string
                    ok?: boolean
                    reason?: string
                    openDoc?: string
                }
                if (d.reqId !== reqId) return
                clearTimeout(timer)
                window.removeEventListener('llm-cfx-apply-reply', onReply)
                if (d.ok) setApplyState({ kind: 'applied' })
                else setApplyState({ kind: 'failed', reason: d.reason || 'error', openDoc: d.openDoc })
                resolve()
            }
            window.addEventListener('llm-cfx-apply-reply', onReply)
            window.dispatchEvent(
                new CustomEvent('llm-cfx-apply-request', {
                    detail: {
                        reqId,
                        file: result.file,
                        line: result.line,
                        span: result.span,
                        suggestedOld: result.suggestedOld,
                        suggestedNew: result.suggestedNew
                    }
                })
            )
        })
    }, [status])

    const applyStatusLine = useCallback(() => {
        if (applyState.kind === 'applied') {
            return (
                <span className="llm-cfx-apply-status llm-cfx-apply-status-ok">
                    {t('llm_cfx_applied', 'Applied — recompile to see the result.')}
                </span>
            )
        }
        if (applyState.kind === 'failed' && applyState.reason === 'already-applied') {
            return (
                <span className="llm-cfx-apply-status llm-cfx-apply-status-ok">
                    {t('llm_cfx_already', 'This fix looks like it is already in the document.')}
                </span>
            )
        }
        if (applyState.kind === 'failed') {
            let msg: string | React.ReactNode
            if (applyState.reason === 'wrong-doc') {
                msg = (
                    <span>
                        {t('llm_cfx_apply_open', 'Open ')}
                        <strong>
                            {applyState.openDoc || t('llm_cfx_apply_thedoc', 'the document')}
                        </strong>{' '}
                        {t('llm_cfx_apply_then', 'to apply the fix.')}
                    </span>
                )
            } else if (applyState.reason === 'not-found') {
                msg = t('llm_cfx_apply_notfound', 'That text is no longer there — the line may have changed. Suggest a new fix.')
            } else if (applyState.reason === 'read-only') {
                msg = t('llm_cfx_apply_readonly', 'You do not have edit rights on this project.')
            } else {
                msg = t('llm_cfx_apply_error', 'Could not apply the fix right now — please try again.')
            }
            return <span className="llm-cfx-apply-status">{msg}</span>
        }
        return null
    }, [applyState, t])

    if (!logEntry || status.status === 'idle') return null

    if (status.status === 'running') {
        return (
            <div className="llm-cfx llm-cfx-running" role="status">
                <span className="llm-cfx-spinner" aria-hidden="true" />
                <span>{t('llm_cfx_running', 'Suggesting a fix…')}</span>
            </div>
        )
    }

    if (status.status === 'error') {
        return (
            <div className="llm-cfx llm-cfx-error" role="alert">
                <span>{status.message}</span>
                <button type="button" className="llm-cfx-btn" onClick={differentFix}>
                    <MaterialIcon type="refresh" style={{ fontSize: 16 }} />
                    {t('llm_cfx_different', 'Suggest a different fix')}
                </button>
            </div>
        )
    }

    const result = status.result
    const { fromHtml, toHtml, lineFrom, lineTo } = renderSuggestedLines(result)
    const explanation = result.explanation || ''
    const explanationHtml = explanation
        ? DOMPurify.sanitize(marked.parse(explanation) as string)
        : ''

    return (
        <div className="llm-cfx">
            <div className="llm-cfx-heading">
                <MaterialIcon type="smart_toy" style={{ fontSize: 18 }} />
                {t('llm_cfx_heading', 'Suggested fix for error in ')}
                {(result.file || logEntry.file || '').split('/').pop()}
            </div>
            {explanation ? (
                <div
                    className="llm-cfx-explanation llm-result-html"
                    dangerouslySetInnerHTML={{ __html: explanationHtml }}
                />
            ) : (
                <div className="llm-cfx-explanation">
                    {t('llm_cfx_no_explanation', 'Suggested change near line ')}
                    {result.line}
                </div>
            )}
            <div className="llm-cfx-code">
                <div className="llm-cfx-code-header">
                    <span className="llm-cfx-code-title">
                        {t('llm_cfx_suggested_code', 'Suggested code')}
                    </span>
                    <button
                        type="button"
                        className="llm-cfx-copy"
                        aria-label={t('copy', 'Copy')}
                        onClick={() => void copy()}
                    >
                        <MaterialIcon type={copied ? 'check' : 'content_copy'} style={{ fontSize: 16 }} />
                        {copied ? t('llm_copied', 'Copied') : t('copy', 'Copy')}
                    </button>
                </div>
                <div className="llm-cfx-from">
                    <MaterialIcon type="remove" className="llm-cfx-diff-icon" />
                    <span className="llm-cfx-linenum">{lineFrom}</span>
                    <code className="llm-cfx-code-text" dangerouslySetInnerHTML={{ __html: fromHtml }} />
                </div>
                <div className="llm-cfx-to">
                    <MaterialIcon type="add" className="llm-cfx-diff-icon" />
                    <span className="llm-cfx-linenum">{lineTo}</span>
                    <code className="llm-cfx-code-text" dangerouslySetInnerHTML={{ __html: toHtml }} />
                </div>
            </div>
            <div className="llm-cfx-actions">
                <button
                    type="button"
                    className="llm-cfx-btn llm-cfx-apply"
                    onClick={() => void apply()}
                    disabled={applyState.kind === 'pending' || applyState.kind === 'applied'}
                >
                    <MaterialIcon type={applyState.kind === 'applied' ? 'check' : 'check_circle'} style={{ fontSize: 16 }} />
                    {applyState.kind === 'applied'
                        ? t('llm_cfx_applied_btn', 'Applied')
                        : applyState.kind === 'pending'
                            ? t('llm_cfx_applying', 'Applying…')
                            : t('llm_cfx_apply', 'Apply fix')}
                </button>
                <button type="button" className="llm-cfx-btn llm-cfx-again" onClick={differentFix}>
                    <MaterialIcon type="refresh" style={{ fontSize: 16 }} />
                    {t('llm_cfx_different', 'Suggest a different fix')}
                </button>
                {applyStatusLine()}
            </div>
            <div className="llm-cfx-footer">
                {t('llm_cfx_footer', 'AI can make mistakes. Review fixes before you apply them.')}
            </div>
        </div>
    )
}

export default PdfLlmCompileFixCard
