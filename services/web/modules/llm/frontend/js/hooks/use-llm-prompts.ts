import { useEffect, useState } from 'react'
import getMeta from '@/utils/meta'
import { getJSON } from '@/infrastructure/fetch-json'

// overleaf-lab: shared client-side view of the admin-editable LLM prompts
// (Ask-AI system prompt, error prompt, per-action transform templates) for the
// CURRENT project. The backend is the source of truth; the frontend uses these
// only to override its hardcoded fallbacks when an admin has customized them.
// The prompts are fetched once and cached at module level so every caller
// (selection toolbar, error "Ask AI" button, ...) shares a single request
// instead of each refetching.

export type Prompts = {
    askAiSystemPrompt?: string
    errorPrompt?: string
    askAiActionPrompts?: Record<string, string>
}

export type PromptsState = {
    // overleaf-lab: `null` means "no admin prompts available" (no project
    // context, fetch failed, or empty payload). Callers then use their own
    // hardcoded fallback verbatim.
    prompts: Prompts | null
    loaded: boolean
}

// overleaf-lab: value used when there is no project context or the fetch fails.
// Callers keep their hardcoded prompts as the effective fallback.
const NO_PROMPTS: PromptsState = {
    prompts: null,
    loaded: true,
}

// overleaf-lab: module-level cache + in-flight promise dedupe the fetch across
// every hook instance mounted in the same page.
let cache: PromptsState | null = null
let inflight: Promise<PromptsState> | null = null

function fetchPrompts(): Promise<PromptsState> {
    if (inflight) return inflight

    const projectId = getMeta('ol-project_id')
    if (!projectId) {
        // overleaf-lab: no project context (e.g. outside the editor). Cache the
        // empty result so callers stop waiting and use their own fallback.
        cache = { ...NO_PROMPTS }
        inflight = Promise.resolve(cache)
        return inflight
    }

    // F14: shared fetch utility (CSRF/JSON handled; throws FetchError on non-ok).
    inflight = getJSON(`/project/${projectId}/llm/prompts`)
        .then((data: any) => {
            // overleaf-lab: keep only well-typed fields; anything missing stays
            // undefined so callers fall back to their hardcoded value per field.
            const prompts: Prompts = {
                askAiSystemPrompt:
                    typeof data?.askAiSystemPrompt === 'string'
                        ? data.askAiSystemPrompt
                        : undefined,
                errorPrompt:
                    typeof data?.errorPrompt === 'string'
                        ? data.errorPrompt
                        : undefined,
                askAiActionPrompts:
                    data?.askAiActionPrompts &&
                    typeof data.askAiActionPrompts === 'object'
                        ? (data.askAiActionPrompts as Record<string, string>)
                        : undefined,
            }
            const state: PromptsState = { prompts, loaded: true }
            cache = state
            return state
        })
        .catch(() => {
            // overleaf-lab: on failure, callers keep their hardcoded prompts.
                        cache = { ...NO_PROMPTS }
            return cache
        })

    return inflight
}

export function useLLMPrompts(): PromptsState {
    const [state, setState] = useState<PromptsState>(
        cache ?? { prompts: null, loaded: false }
    )

    useEffect(() => {
        let cancelled = false

        if (cache) {
            // overleaf-lab: already resolved earlier; adopt it.
            setState(cache)
            return
        }

        fetchPrompts().then(result => {
            // overleaf-lab: guard against setState after unmount.
            if (!cancelled) setState(result)
        })

        return () => {
            cancelled = true
        }
    }, [])

    return state
}
