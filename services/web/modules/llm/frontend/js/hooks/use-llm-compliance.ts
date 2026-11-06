import { useCallback, useEffect, useRef, useState } from 'react'
import getMeta from '@/utils/meta'
import { getJSON, postJSON } from '@/infrastructure/fetch-json'

// overleaf-lab: shapes for the document compliance review feature. The backend is
// now a job queue: start enqueues a review and returns a jobId, the client polls
// a status endpoint, and can cancel. Every endpoint always returns HTTP 200 and
// the body carries either a success payload (ok:true) or a logical error.

export interface ComplianceRubric {
    id: string
    name: string
}

export type ComplianceStatus = 'ok' | 'partial' | 'missing' | 'na'

export interface ComplianceItem {
    requirement: string
    status: ComplianceStatus
    evidence: string
    suggestion: string
}

export interface ComplianceResult {
    ok: true
    rubric: ComplianceRubric
    model: string
    documentTokensEstimate: number
    maxContextTokens: number
    summary: string
    items: ComplianceItem[]
}

export type ComplianceErrorCode =
    | 'disabled'
    | 'busy'
    | 'no_rubric'
    | 'not_configured'
    | 'empty_document'
    | 'too_long'
    | 'model_unavailable'
    | 'not_found'
    | 'backend_error'
    | 'failed'

// overleaf-lab: kept for callers that still reference the raw error shape.
export interface ComplianceError {
    ok: false
    error: ComplianceErrorCode
    message: string
    documentTokensEstimate?: number
    maxContextTokens?: number
}

// overleaf-lab: the phase drives the whole pane UI.
export type CompliancePhase = 'idle' | 'queued' | 'running' | 'done' | 'error'

// overleaf-lab: live progress of a running review. The review is multi-pass (one
// model call per rubric requirement), so progress is REAL: passes completed over
// total, plus the requirement currently being checked. 'preparing' is the document
// assembly before the first pass, 'summarizing' the final small synthesis call.
export interface ReviewProgress {
    phase: 'preparing' | 'checking' | 'summarizing'
    passesDone: number
    passesTotal: number
    currentRequirement: string
    elapsedMs: number
}

// overleaf-lab: normalized error info the pane renders. The code lives in
// `errorCode` (from either the start body's `error` or the status body's
// `errorCode`), so the pane reads a single field.
export interface ComplianceErrorInfo {
    errorCode: ComplianceErrorCode | string
    message?: string
    documentTokensEstimate?: number
    maxContextTokens?: number
    // overleaf-lab: the room reserved for the answer. It is part of the sum that
    // caused a too_long refusal, so the UI must show it or the numbers look wrong.
    reviewMaxTokens?: number
}

interface RubricsResponse {
    rubrics?: ComplianceRubric[]
}

// overleaf-lab: escape user/model text before embedding it in the HTML report.
function escapeHtml(s: string): string {
    return String(s || '').replace(
        /[&<>"']/g,
        c =>
            (({
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#39;',
            }) as Record<string, string>)[c] || c
    )
}

// overleaf-lab: build a self-contained, styled HTML report from a finished result.
// It opens in any browser and can be saved as PDF via the browser's Print dialog,
// which avoids bundling a PDF library. Colors are fixed (a printable light document),
// independent of the app theme.
export function buildReportHtml(result: ComplianceResult): string {
    const counts: Record<ComplianceStatus, number> = {
        ok: 0,
        partial: 0,
        missing: 0,
        na: 0,
    }
    for (const item of result.items) {
        counts[item.status] = (counts[item.status] || 0) + 1
    }

    const statusLabel: Record<ComplianceStatus, string> = {
        ok: 'OK',
        partial: 'Partial',
        missing: 'Missing',
        na: 'N/A',
    }
    const statusColor: Record<ComplianceStatus, string> = {
        ok: '#198754',
        partial: '#f59e0b',
        missing: '#dc3545',
        na: '#6c757d',
    }

    const itemsHtml = result.items
        .map(item => {
            const color = statusColor[item.status] || '#6c757d'
            const label = statusLabel[item.status] || 'N/A'
            const evidence = item.evidence
                ? `<div class="ev"><strong>Evidence:</strong> ${escapeHtml(item.evidence)}</div>`
                : ''
            const suggestion = item.suggestion
                ? `<div class="sg"><strong>Suggestion:</strong> ${escapeHtml(item.suggestion)}</div>`
                : ''
            return `<div class="item"><div class="req"><span class="badge" style="background:${color}">${label}</span> ${escapeHtml(
                item.requirement
            )}</div>${evidence}${suggestion}</div>`
        })
        .join('\n')

    const title = `Compliance review - ${escapeHtml(result.rubric.name)}`

    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>
<style>
  body{font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:820px;margin:2rem auto;padding:0 1rem;color:#1a1a1a;line-height:1.5}
  h1{font-size:1.5rem;margin:0 0 .25rem}
  h2{font-size:1.15rem;margin:1.5rem 0 .5rem}
  .meta{color:#6c757d;font-size:.9rem;margin-bottom:1rem}
  .summary{background:#f3f4f6;border-radius:8px;padding:1rem;margin:1rem 0;white-space:pre-wrap}
  .counts span{display:inline-block;margin-right:1.25rem;font-weight:600}
  .item{border-top:1px solid #e5e7eb;padding:.75rem 0}
  .req{font-weight:600}
  .badge{color:#fff;border-radius:4px;padding:1px 7px;font-size:.72rem;margin-right:6px;vertical-align:middle}
  .ev,.sg{font-size:.9rem;color:#374151;margin-top:.3rem}
  @media print{body{margin:0;max-width:none}}
</style></head>
<body>
  <h1>${title}</h1>
  <div class="meta">Model: ${escapeHtml(result.model)} - about ${result.documentTokensEstimate} tokens</div>
  <div class="counts">
    <span style="color:#198754">OK ${counts.ok || 0}</span>
    <span style="color:#f59e0b">Partial ${counts.partial || 0}</span>
    <span style="color:#dc3545">Missing ${counts.missing || 0}</span>
    <span style="color:#6c757d">N/A ${counts.na || 0}</span>
  </div>
  <div class="summary">${escapeHtml(result.summary)}</div>
  <h2>Requirements</h2>
  ${itemsHtml}
  <p class="meta">Tip: use your browser's Print dialog to save this report as PDF.</p>
</body></html>`
}

export const useLLMCompliance = () => {
    const projectId = getMeta('ol-project_id')

    const [rubrics, setRubrics] = useState<ComplianceRubric[]>([])
    const [rubricsLoaded, setRubricsLoaded] = useState(false)
    const [selectedRubricId, setSelectedRubricId] = useState('')
    // overleaf-lab (owner request 2026-08-25): the Review tab uses the ONE
    // shared model selection — see use-llm-model-selection (the "Select LLM
    // Model" dialog). No per-pane model state here.
    const [phase, setPhase] = useState<CompliancePhase>('idle')
    const [position, setPosition] = useState(0)
    const [result, setResult] = useState<ComplianceResult | null>(null)
    const [errorInfo, setErrorInfo] = useState<ComplianceErrorInfo | null>(null)
    const [progress, setProgress] = useState<ReviewProgress | null>(null)

    // overleaf-lab: refs so async callbacks and the unload handler always see the
    // current values without re-subscribing.
    const jobIdRef = useRef<string | null>(null)
    const phaseRef = useRef<CompliancePhase>('idle')
    const pollRef = useRef<number | null>(null)
    const mountedRef = useRef(true)

    // overleaf-lab: keep the phase ref in sync for the beforeunload handler.
    useEffect(() => {
        phaseRef.current = phase
    }, [phase])

    // overleaf-lab: tick the elapsed clock locally between the 2s status polls so it
    // moves smoothly; each poll re-syncs it from the server (authoritative). The bar
    // itself only moves on real pass completions reported by the server.
    useEffect(() => {
        if (phase !== 'running') return undefined
        const id = window.setInterval(() => {
            setProgress(prev =>
                prev ? { ...prev, elapsedMs: prev.elapsedMs + 1000 } : prev
            )
        }, 1000)
        return () => window.clearInterval(id)
    }, [phase])

    const stopPolling = useCallback(() => {
        if (pollRef.current != null) {
            clearInterval(pollRef.current)
            pollRef.current = null
        }
    }, [])

    // overleaf-lab: mount/unmount bookkeeping. On unmount we only stop polling; we
    // do NOT cancel the job, since the pane may just be hidden by a tab switch.
    useEffect(() => {
        mountedRef.current = true
        return () => {
            mountedRef.current = false
            stopPolling()
        }
    }, [stopPolling])

    // overleaf-lab: load the admin-defined rubrics once on mount. On any failure
    // we still mark the list as loaded (with an empty array) so the pane can show
    // the "no rubrics configured" message instead of spinning forever.
    useEffect(() => {
        let cancelled = false

        async function fetchRubrics() {
            if (!projectId) {
                setRubrics([])
                setRubricsLoaded(true)
                return
            }
            try {
                // F14: shared fetch utility (CSRF/JSON handling + typed FetchError).
                const data: RubricsResponse = await getJSON(
                    `/project/${projectId}/llm/compliance/rubrics`
                )
                if (cancelled) return

                const loadedRubrics = data.rubrics || []
                setRubrics(loadedRubrics)
                setSelectedRubricId(loadedRubrics[0]?.id || '')
                setRubricsLoaded(true)
            } catch (err) {
                                if (cancelled) return
                setRubrics([])
                setRubricsLoaded(true)
            }
        }

        fetchRubrics()

        return () => {
            cancelled = true
        }
    }, [projectId])

    // overleaf-lab (owner request 2026-08-25): the Review run uses the ONE
    // shared model selection (the "Select LLM Model" dialog / use-llm-model-
    // selection hook) — no per-pane model list fetch here anymore.

    // overleaf-lab: one poll tick. Updates phase/position/result/errorInfo and
    // stops polling on any terminal state (done/error/cancelled/not_found).
    const pollOnce = useCallback(
        async (jobId: string) => {
            try {
                // F14: shared fetch utility. The endpoint reports unknown/expired
                // jobs as 200 + {ok:false}, so getJSON resolves and the json.ok
                // branch below still handles them exactly as before.
                const json = await getJSON(
                    `/project/${projectId}/llm/compliance/status/${jobId}`
                )
                if (!mountedRef.current) return

                if (!json.ok) {
                    // Missing, foreign, or expired job.
                    stopPolling()
                    jobIdRef.current = null
                    setErrorInfo({
                        errorCode: 'not_found',
                        message: json.message || 'Review not found or expired',
                    })
                    setPhase('error')
                    return
                }

                switch (json.status) {
                    case 'queued':
                        setPhase('queued')
                        setPosition(typeof json.position === 'number' ? json.position : 0)
                        setProgress(null)
                        break
                    case 'running':
                        setPhase('running')
                        if (
                            typeof json.passesTotal === 'number' &&
                            json.passesTotal > 0
                        ) {
                            setProgress({
                                phase:
                                    json.phase === 'summarizing'
                                        ? 'summarizing'
                                        : 'checking',
                                passesDone:
                                    typeof json.passesDone === 'number'
                                        ? json.passesDone
                                        : 0,
                                passesTotal: json.passesTotal,
                                currentRequirement:
                                    typeof json.currentRequirement === 'string'
                                        ? json.currentRequirement
                                        : '',
                                elapsedMs:
                                    typeof json.elapsedMs === 'number' ? json.elapsedMs : 0,
                            })
                        } else {
                            // Still assembling the document: the rubric is not split yet.
                            setProgress({
                                phase: 'preparing',
                                passesDone: 0,
                                passesTotal: 0,
                                currentRequirement: '',
                                elapsedMs: 0,
                            })
                        }
                        break
                    case 'done':
                        stopPolling()
                        jobIdRef.current = null
                        setResult(json.result as ComplianceResult)
                        setErrorInfo(null)
                        setProgress(null)
                        setPhase('done')
                        break
                    case 'error':
                        stopPolling()
                        jobIdRef.current = null
                        setErrorInfo({
                            errorCode: json.errorCode,
                            message: json.message,
                            documentTokensEstimate: json.documentTokensEstimate,
                            maxContextTokens: json.maxContextTokens,
                            reviewMaxTokens: json.reviewMaxTokens,
                        })
                        setProgress(null)
                        setPhase('error')
                        break
                    case 'cancelled':
                        stopPolling()
                        jobIdRef.current = null
                        setProgress(null)
                        setPhase('idle')
                        break
                    default:
                        break
                }
            } catch (err) {
                // overleaf-lab: a transient network error should not kill the poll;
                // keep the interval and try again on the next tick.
                            }
        },
        [projectId, stopPolling]
    )

    const startPolling = useCallback(
        (jobId: string) => {
            stopPolling()
            pollRef.current = window.setInterval(() => {
                pollOnce(jobId)
            }, 2000)
        },
        [pollOnce, stopPolling]
    )

    const runReview = useCallback(
        async (modelOverride?: string) => {
            if (!selectedRubricId) return

            setResult(null)
            setErrorInfo(null)
            setPosition(0)
            setProgress(null)

            try {
                // F14: postJSON adds the CSRF header + JSON content type itself.
                const json = await postJSON(
                    `/project/${projectId}/llm/compliance/start`,
                    {
                        body: {
                            rubricId: selectedRubricId,
                            // overleaf-lab: model selector — explicit model ref
                            // or omitted = deployment default.
                            ...(modelOverride ? { model: modelOverride } : {}),
                        },
                    }
                )
            if (!mountedRef.current) return

            if (json.ok) {
                jobIdRef.current = json.jobId
                const startPhase: CompliancePhase =
                    json.status === 'running' ? 'running' : 'queued'
                setPhase(startPhase)
                setPosition(typeof json.position === 'number' ? json.position : 0)
                startPolling(json.jobId)
            } else {
                setErrorInfo({ errorCode: json.error, message: json.message })
                setPhase('error')
            }
        } catch (err) {
                        if (!mountedRef.current) return
            setErrorInfo({ errorCode: 'failed', message: 'Request failed' })
            setPhase('error')
        }
    }, [projectId, selectedRubricId, startPolling])

    const cancelReview = useCallback(async () => {
        const jobId = jobIdRef.current
        stopPolling()
        setPhase('idle')
        setPosition(0)
        setProgress(null)
        jobIdRef.current = null
        if (!jobId) return

        try {
            // F14: shared fetch utility (CSRF/JSON handled by the wrapper).
            await postJSON(`/project/${projectId}/llm/compliance/cancel/${jobId}`)
        } catch (err) {
                    }
    }, [projectId, stopPolling])

    // overleaf-lab: best-effort cancel on page refresh/close. keepalive lets the
    // request survive the unload. Only fire when a job is actually active. We do
    // NOT cancel on a normal unmount (a tab switch just hides the pane).
    useEffect(() => {
        const handler = () => {
            const jobId = jobIdRef.current
            const currentPhase = phaseRef.current
            if (
                jobId &&
                (currentPhase === 'queued' || currentPhase === 'running')
            ) {
                // F14 + keepalive: the helper forwards config to fetch, so the
                // best-effort cancel still survives the page unload.
                postJSON(
                    `/project/${projectId}/llm/compliance/cancel/${jobId}`,
                    { keepalive: true }
                )
                    .then(
                        () => undefined,
                        () => undefined
                    )
            }
        }

        window.addEventListener('beforeunload', handler)
        return () => {
            window.removeEventListener('beforeunload', handler)
        }
    }, [projectId])

    // overleaf-lab: build a self-contained HTML report and trigger a client-side
    // download. Open it in a browser and Print to PDF for a PDF copy.
    const downloadReport = useCallback(() => {
        if (!result) return

        const html = buildReportHtml(result)
        const safeRubricName =
            (result.rubric?.name || 'review')
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '-')
                .replace(/^-+|-+$/g, '') || 'review'

        const now = new Date()
        const pad = (n: number) => String(n).padStart(2, '0')
        const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(
            now.getDate()
        )}-${pad(now.getHours())}${pad(now.getMinutes())}`
        const filename = `review-${safeRubricName}-${stamp}.html`

        const blob = new Blob([html], {
            type: 'text/html;charset=utf-8',
        })
        const url = URL.createObjectURL(blob)
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = filename
        document.body.appendChild(anchor)
        anchor.click()
        document.body.removeChild(anchor)
        URL.revokeObjectURL(url)
    }, [result])

    return {
        rubrics,
        rubricsLoaded,
        hasRubrics: rubrics.length > 0,
        selectedRubricId,
        setSelectedRubricId,
        phase,
        position,
        progress,
        result,
        errorInfo,
        runReview,
        cancelReview,
        downloadReport,
    }
}
