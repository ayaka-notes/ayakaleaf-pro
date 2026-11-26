// overleaf-lab: tiny cross-component store for the chat's currently selected
// model id. The chat panel (use-llm-chat) and the selection toolbar / "Ask AI"
// (llm-toolbar) live in separate React trees, so a plain module value would not
// survive between them. localStorage bridges the two: the chat writes the chosen
// model, the toolbar reads it so "Ask AI" uses the same model as the chat.
//
// Selections are PER PROJECT (llm.chat.selectedModel.<projectId>) when a project
// id is available, so switching projects does not lose the project's model; a
// global key (llm.chat.selectedModel) is the fallback, which also keeps
// non-project contexts working.
import customLocalStorage from '@/infrastructure/local-storage'

const PROJECT_PREFIX = 'llm.chat.selectedModel.'
const GLOBAL_KEY = 'llm.chat.selectedModel'

function storageKey(projectId?: string): string {
    return projectId ? PROJECT_PREFIX + projectId : GLOBAL_KEY
}

export function readSelectedModel(projectId?: string): string {
    try {
        if (projectId) {
            const scoped = customLocalStorage.getItem(PROJECT_PREFIX + projectId)
            if (scoped) {
                return scoped
            }
        }
        return customLocalStorage.getItem(GLOBAL_KEY) || ''
    } catch {
        return '' // storage disabled / private mode: fall back to server default
    }
}

export function writeSelectedModel(modelId: string, projectId?: string): void {
    try {
        if (modelId) {
            customLocalStorage.setItem(storageKey(projectId), modelId)
        } else {
            customLocalStorage.removeItem(storageKey(projectId))
            customLocalStorage.removeItem(GLOBAL_KEY)
        }
    } catch {
        // ignore: storage disabled / private mode
    }
}
