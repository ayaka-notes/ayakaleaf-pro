// overleaf-lab (2026): AI Error Assist — per-log-entry suggested-fix state.
//
// The trigger (the per-entry "Suggest a fix" action in
// pdfLogEntryHeaderActionComponents) and the result card (pdfLogEntryComponents)
// are two separate React trees rendered by core, so they share state through
// this tiny module store (plus a window event for cross-tree wake-up, the same
// pattern the chat rail already uses). Selection of the model to run against
// is the SHARED "Select LLM Model" choice (llm-selected-model store): site
// lane or any BYO row — the BYO-first stance of this deployment.
import { postJSON } from '@/infrastructure/fetch-json'
import getMeta from '@/utils/meta'

export interface CompileFixResult {
    ok: true
    file: string
    line: number
    startLine: number
    snippet: string
    explanation: string
    suggestedOld: string
    suggestedNew: string
    span?: [number, number]
    lane: string
    model: string
}

export type CompileFixStatus =
    | { status: 'idle' }
    | { status: 'running' }
    | { status: 'error'; message: string }
    | { status: 'result'; result: CompileFixResult }

export interface LogEntryLike {
    key?: string
    file?: string
    line?: number
    level?: string
    message?: string
    raw?: string
}

export const LLM_COMPILE_FIX_EVENT = 'overleaf-llm-compile-fix-changed'

const states = new Map<string, CompileFixStatus>()
const listeners = new Set<() => void>()

export function keyForLogEntry(entry?: LogEntryLike): string {
    if (entry?.key) return entry.key
    return `${entry?.file || 'file'}@${entry?.line || 0}`
}

export function getCompileFixStatus(entry?: LogEntryLike): CompileFixStatus {
    return states.get(keyForLogEntry(entry)) || { status: 'idle' }
}

export function subscribeCompileFix(listener: () => void): () => void {
    listeners.add(listener)
    return () => {
        listeners.delete(listener)
    }
}

function setCompileFixStatus(entry: LogEntryLike, status: CompileFixStatus): void {
    states.set(keyForLogEntry(entry), status)
    for (const l of Array.from(listeners)) {
        try {
            l()
        }
        catch {
            // a broken listener must not break the state transition
        }
    }
    try {
        // Cross-React-tree wake-up (the card may not subscribe early enough).
        window.dispatchEvent(new CustomEvent(LLM_COMPILE_FIX_EVENT))
    }
    catch {
        // no window (SSR/test) — the direct listeners already fired
    }
}

// Runs (or re-runs) the "suggest fix" model call for one log entry and keeps
// the per-entry state in sync. `previous` (from "Suggest a different fix")
// tells the backend which suggestion to avoid.
export async function requestCompileFix(
    entry: LogEntryLike,
    previous?: { old: string; new: string } | null
): Promise<void> {
    if (!entry.file || !entry.line) return
    const projectId = getMeta('ol-project_id')
    if (!projectId) return
    const current = getCompileFixStatus(entry)
    if (current.status === 'running') return
    setCompileFixStatus(entry, { status: 'running' })

    // overleaf-lab: the SHARED "Select LLM Model" choice drives every LLM
    // surface, Error Assist included (empty = deployment default lane).
    // overleaf-lab (owner item 2026-08-26): NO explicit model here — the
    // backend resolves the user's profile selection (File → "Select LLM
    // Model") for every surface, so "Suggest a fix" always runs on exactly
    // the user's chosen model (previously a stale local bridge value could
    // win over it).
    const body: Record<string, unknown> = {
        file: entry.file,
        line: entry.line,
        level: entry.level || 'error',
        message: entry.message || entry.raw || '',
    }
    if (previous && (previous.old || previous.new)) {
        body.hint = { old: previous.old, new: previous.new }
    }

    try {
        const data = await postJSON(`/project/${projectId}/llm/compile-fix`, { body })
        if (data && data.ok) {
            setCompileFixStatus(entry, {
                status: 'result',
                result: data as CompileFixResult
            })
        }
        else {
            setCompileFixStatus(entry, {
                status: 'error',
                message: (data && data.message) || 'Could not get a suggestion — please try again.'
            })
        }
    }
    catch (err) {
        // fetchJSON raises FetchError with the parsed body on `data` — the
        // server's `message` is the user-facing one; the HTTP status text
        // ("Bad Gateway") is not, so prefer the body, else a generic line.
        const serverMessage =
            err && typeof err === 'object' && (err as { data?: { message?: string } }).data?.message
        setCompileFixStatus(entry, {
            status: 'error',
            message: serverMessage || 'The request failed — please try again.'
        })
    }
}

export default {
    LLM_COMPILE_FIX_EVENT,
    keyForLogEntry,
    getCompileFixStatus,
    subscribeCompileFix,
    requestCompileFix
}
