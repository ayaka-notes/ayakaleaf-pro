// overleaf-lab: shared LLM model selection (owner request): ONE model choice,
// made via File → "Select LLM Model" (the menu's only selection entry point),
// is used by ALL AI surfaces — Chat AI Assistant, Review, AI Generate
// (Title/Abstract/Keywords) and the ask-AI selection context menu.
//
// overleaf-lab (owner request 2026-08-26): the selection is USER-SCOPED, not
// project-scoped: it is stored on the user profile (server-side,
// GET/POST /user/llm/selected-model) and applies across every project and
// browser. localStorage is kept only as the same-tab instant bridge between
// the surfaces (chat hook, toolbar) that live in separate React trees.
import { useCallback, useEffect, useState } from 'react'
import getMeta from '@/utils/meta'
import { getJSON, postJSON } from '@/infrastructure/fetch-json'
import { readSelectedModel, writeSelectedModel } from '../utils/llm-selected-model'

export const LLM_MODEL_CHANGED_EVENT = 'overleaf-llm-model-changed'

export interface LLMModelOption {
    value: string // model id / `u:<rowId>:<model>` (no '' pseudo-option anymore)
    label: string
    rowName?: string
    /** overleaf-lab (2026-11): provider badge — "Site · <host>" for site models,
     * the BYO row name for user rows (several providers can serve the same
     * model name, so the picker always shows which one this is). */
    provider?: string
}

export const LLM_TASK_KEYS = ['chat', 'completion', 'review', 'error'] as const
export type LLMTask = (typeof LLM_TASK_KEYS)[number]

async function fetchServerSelection(): Promise<{
    selected: string
    tasks: Record<string, string>
}> {
    try {
        const data: any = await getJSON('/user/llm/selected-model')
        const value = typeof data?.selected === 'string' ? data.selected : ''
        const tasks: Record<string, string> = {}
        for (const k of LLM_TASK_KEYS) {
            tasks[k] = data?.tasks && typeof data.tasks[k] === 'string' ? data.tasks[k] : ''
        }
        return { selected: value, tasks }
    }
    catch {
        return { selected: '', tasks: { chat: '', completion: '', review: '', error: '' } }
    }
}

export function useLLMModelSelection() {
    const projectId = (getMeta('ol-project_id') as string | undefined) || undefined
    const [options, setOptions] = useState<LLMModelOption[]>([])
    const [loaded, setLoaded] = useState(false)
    const [selected, setSelected] = useState<string>(() => readSelectedModel(projectId))
    // overleaf-lab (2026-11): per-task model overrides ('' = use the shared default).
    const [tasks, setTasks] = useState<Record<string, string>>({
        chat: '', completion: '', review: '', error: '',
    })

    useEffect(() => {
        if (!projectId) {
            setLoaded(true)
            return
        }
        let cancelled = false
        async function load() {
            try {
                // Shared with the chat hook's model list: site models first,
                // then BYO rows namespaced u:<rowId>:<model>.
                const data: any = await getJSON<{
                    models?: Array<{ id: string; name?: string; isDefault?: boolean }>
                    userRows?: Array<{ id: string; name: string; models: Array<{ id: string; name?: string }> }>
                }>(`/project/${projectId}/llm/models`)
                if (cancelled) return
                const opts: LLMModelOption[] = []
                const siteProvider = typeof data.siteProvider === 'string' ? data.siteProvider : undefined
                for (const m of data.models || []) {
                    opts.push({ value: m.id, label: m.name || m.id, provider: siteProvider })
                }
                for (const row of data.userRows || []) {
                    for (const m of row.models || []) {
                        // overleaf-lab: the backend already returns fully
                        // namespaced ids (u:<rowId>:<model>) — use as-is.
                        opts.push({
                            value: m.id,
                            label: m.name || m.id,
                            rowName: row.name,
                            provider: row.name,
                        })
                    }
                }
                setOptions(opts)

                const serverSel = await fetchServerSelection()
                if (cancelled) return
                setTasks(serverSel.tasks)
                const serverValue = serverSel.selected
                const storedValue = readSelectedModel(projectId)
                const next =
                    (serverValue && opts.some(o => o.value === serverValue) && serverValue) ||
                    (storedValue && opts.some(o => o.value === storedValue) && storedValue) ||
                    ''
                if (next !== storedValue) {
                    writeSelectedModel(next, projectId)
                    setSelected(next)
                    if (next) {
                        // Tell the other surfaces (chat hook) about the
                        // restored user selection.
                        window.dispatchEvent(
                            new CustomEvent(LLM_MODEL_CHANGED_EVENT, { detail: { value: next } }),
                        )
                    }
                }
                setLoaded(true)
            }
            catch {
                if (!cancelled) {
                    // Model list unavailable (LLM disabled for this project?):
                    // no options; requests fall back to the deployment default.
                    setLoaded(true)
                }
            }
        }
        load()
        return () => {
            cancelled = true
        }
    }, [projectId])

    // Keep the selection in sync across surface instances.
    useEffect(() => {
        const handler = (e: Event) => {
            const value = (e as CustomEvent).detail?.value
            if (typeof value === 'string') setSelected(value)
        }
        window.addEventListener(LLM_MODEL_CHANGED_EVENT, handler)
        return () => window.removeEventListener(LLM_MODEL_CHANGED_EVENT, handler)
    }, [])

    const apply = useCallback(
        (value: string, task?: string) => {
            if (task) {
                // overleaf-lab (2026-11): per-task override — stored on the
                // profile; the shared default and the local bridge are left
                // untouched so "All tasks" keeps its own value.
                void postJSON('/user/llm/selected-model', { body: { selected: value, task } })
                    .then(() => {
                        setTasks(prev => ({ ...prev, [task]: value }))
                    })
                    .catch(() => { /* profile write failed */ })
                return
            }
            writeSelectedModel(value, projectId)
            setSelected(value)
            window.dispatchEvent(
                new CustomEvent(LLM_MODEL_CHANGED_EVENT, { detail: { value } }),
            )
            // Persist to the user profile (best-effort; the local bridge
            // already made the choice live everywhere in this tab).
            void postJSON('/user/llm/selected-model', { body: { selected: value } })
                .catch(() => {
                    /* profile write failed — local selection still works */
                })
        },
        [projectId],
    )

    // overleaf-lab (2026-11): effective value for a task = its override, or the
    // shared default when no override (or the default itself) is set.
    const valueFor = useCallback(
        (task?: string) => (
            task && tasks[task] ? tasks[task] : selected
        ),
        [tasks, selected],
    )

    const selectedOption = options.find(o => o.value === selected)
    const selectedLabel = selectedOption
        ? selectedOption.rowName
            ? `${selectedOption.rowName} · ${selectedOption.label}`
            : selectedOption.label
        : options.length
            ? 'Default'
            : ''

    return {
        projectId,
        options,
        loaded,
        selected,
        tasks,
        selectedLabel,
        apply,
        valueFor,
    }
}
