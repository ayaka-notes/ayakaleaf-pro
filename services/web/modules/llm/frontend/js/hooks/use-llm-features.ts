import { useEffect, useState } from 'react'
import getMeta from '@/utils/meta'
import { getJSON } from '@/infrastructure/fetch-json'

// overleaf-lab: shared client-side view of the super-admin LLM feature flags
// (chat / inline completion / compliance review) for the CURRENT project. The
// backend is the source of truth and enforces every flag; the frontend only uses
// this to hide UI cleanly. The flags are fetched once and cached at module level
// so every caller (rail pane, selection toolbar, ...) shares a single request
// instead of each refetching.

export type Features = {
    chatEnabled: boolean
    completionEnabled: boolean
    reviewEnabled: boolean
    allowUserSettings: boolean
    loaded: boolean
}

// overleaf-lab: fail-open value used before the flags load and whenever the
// fetch fails. Features read as enabled; the backend still refuses disabled ones.
const ALL_ENABLED: Features = {
    chatEnabled: true,
    completionEnabled: true,
    reviewEnabled: true,
    allowUserSettings: false,
    loaded: true,
}

// overleaf-lab: module-level cache + in-flight promise dedupe the fetch across
// every hook instance mounted in the same page.
let cache: Features | null = null
let inflight: Promise<Features> | null = null

function fetchFeatures(): Promise<Features> {
    if (inflight) return inflight

    const projectId = getMeta('ol-project_id')
    if (!projectId) {
        // overleaf-lab: no project context (e.g. outside the editor). Treat every
        // feature as enabled and cache it so callers stop waiting.
        cache = { ...ALL_ENABLED }
        inflight = Promise.resolve(cache)
        return inflight
    }

    // F14: shared fetch utility (throws FetchError on non-ok; .catch below maps
    // failures to the all-enabled fallback exactly as before).
    inflight = getJSON(`/project/${projectId}/llm/features`)
        .then((data: any) => {
            // overleaf-lab: every flag defaults to true when absent.
            const features: Features = {
                chatEnabled: data?.chatEnabled !== false,
                completionEnabled: data?.completionEnabled !== false,
                reviewEnabled: data?.reviewEnabled !== false,
                allowUserSettings: data?.allowUserSettings === true,
                loaded: true,
            }
            cache = features
            return features
        })
        .catch(() => {
            // overleaf-lab: fail open on the client; the backend still enforces.
                        cache = { ...ALL_ENABLED }
            return cache
        })

    return inflight
}

export function useLLMFeatures(): Features {
    const [features, setFeatures] = useState<Features>(
        cache ?? {
            chatEnabled: true,
            completionEnabled: true,
            reviewEnabled: true,
            allowUserSettings: false,
            loaded: cache ? true : false,
        }
    )

    useEffect(() => {
        let cancelled = false

        if (cache) {
            // overleaf-lab: already resolved earlier; adopt it.
            setFeatures(cache)
            return
        }

        fetchFeatures().then(result => {
            // overleaf-lab: guard against setState after unmount.
            if (!cancelled) setFeatures(result)
        })

        return () => {
            cancelled = true
        }
    }, [])

    return features
}
