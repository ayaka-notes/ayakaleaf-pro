// overleaf-lab (2026-11, merge phase 2): COPY of the llm module's chat-history
// store, made self-contained because the frontend build does not resolve
// cross-module imports. The workbench assistant is now the ONLY live consumer
// (the llm chat pane is retired); the llm-module original remains for that
// dormant code. Keep the two byte-compatible (DB name, schema, caps) so data
// written by either keeps working.

// overleaf-lab (issue ayaka-notes/ayakaleaf-pro#119, approved 2026-11-23):
// browser-side chat history for the AI Assistant.
//
// Design decisions (see plan approved by owner):
// - IndexedDB (not localStorage): conversation bodies are large (long LaTeX
//   code blocks, whole-document pastes); IDB has async structured clones and a
//   quota of hundreds of MB, localStorage caps at ~5-10 MB.
// - Per-project records keyed by `ol-project_id` — history belongs to the
//   project context, mirroring the server chat endpoint's scoping.
// - Hard caps on write (50 conversations / 200 messages each / ~4M chars) so a
//   pathologically chatty project can never exhaust the IDB quota and take
//   down unrelated IndexedDB consumers on this origin.
// - Fail-safe: every call resolves null / no-op when IndexedDB is unavailable
//   (private-mode restrictions, non-browser contexts) — chat then behaves
//   exactly as before (in-memory only).
// - Zero dependencies: a ~60-line promise wrapper over the IDB API is all it
//   takes; no new package to audit or bundle.

export interface StoredMessage {
    role: 'user' | 'assistant'
    content: string
}

export interface StoredConversation {
    id: string
    title: string
    updatedAt: number
    messages: StoredMessage[]
}

export interface ProjectHistory {
    projectId: string
    activeId: string | null
    conversations: StoredConversation[]
}

const DB_NAME = 'ol-llm-chat-history'
const DB_VERSION = 1
const STORE = 'projects'

export const MAX_CONVERSATIONS = 50
export const MAX_MESSAGES_PER_CONVERSATION = 200
const MAX_CONVERSATION_CHARS = 4_000_000

let dbPromise: Promise<IDBDatabase> | null = null

export function isAvailable(): boolean {
    try {
        return typeof indexedDB !== 'undefined' && indexedDB !== null
    }
    catch {
        return false
    }
}

function openDB(): Promise<IDBDatabase> {
    if (!dbPromise) {
        dbPromise = new Promise((resolve, reject) => {
            let request: IDBOpenDBRequest
            try {
                request = indexedDB.open(DB_NAME, DB_VERSION)
            }
            catch (err) {
                reject(err instanceof Error ? err : new Error(String(err)))
                return
            }
            request.onupgradeneeded = () => {
                const db = request.result
                if (!db.objectStoreNames.contains(STORE)) {
                    db.createObjectStore(STORE, { keyPath: 'projectId' })
                }
            }
            request.onsuccess = () => {
                const db = request.result
                // overleaf-lab: drop the handle on version mismatch so a stale
                // schema cannot be written through.
                db.onversionchange = () => {
                    try {
                        db.close()
                    } catch { /* already closing */ }
                }
                resolve(db)
            }
            request.onerror = () => reject(request.error || new Error('IDB open failed'))
            request.onblocked = () => reject(new Error('IDB open blocked'))
        })
        // Don't cache a rejected handle — retry on the next call.
        dbPromise = dbPromise.catch(err => {
            dbPromise = null
            throw err
        })
    }
    return dbPromise
}

function toPromise<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error || new Error('IDB request failed'))
    })
}

function clampConversation(conv: StoredConversation): StoredConversation {
    let messages = conv.messages
    if (messages.length > MAX_MESSAGES_PER_CONVERSATION) {
        messages = messages.slice(-MAX_MESSAGES_PER_CONVERSATION)
    }
    let text = JSON.stringify(messages)
    // overleaf-lab: character budget per conversation — trim oldest messages
    // until we are under the cap (JSON char length is a tight lower bound on
    // UTF-16 bytes, so this is conservative for the quota).
    let guard = 0
    while (text.length > MAX_CONVERSATION_CHARS && messages.length > 1 && guard++ < 400) {
        messages = messages.slice(1)
        text = JSON.stringify(messages)
    }
    return { ...conv, messages }
}

function clampHistory(history: ProjectHistory): ProjectHistory {
    let conversations = history.conversations
        .slice()
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map(clampConversation)
    if (conversations.length > MAX_CONVERSATIONS) {
        // never silently delete the ACTIVE conversation even if it is the
        // oldest — keep it, drop everything beyond the cap except it.
        const kept = new Set(conversations.slice(0, MAX_CONVERSATIONS).map(c => c.id))
        if (history.activeId && !kept.has(history.activeId)) {
            const active = conversations.find(c => c.id === history.activeId)
            if (active) kept.add(active.id)
        }
        conversations = conversations.filter(c => kept.has(c.id))
    }
    return { ...history, conversations }
}

export async function loadProject(projectId: string): Promise<ProjectHistory | null> {
    if (!isAvailable()) return null
    try {
        const db = await openDB()
        const value = await toPromise(db.transaction(STORE, 'readonly').objectStore(STORE).get(projectId))
        if (!value || !Array.isArray(value.conversations)) return null
        return value as ProjectHistory
    }
    catch {
        return null
    }
}

export async function saveProject(history: ProjectHistory): Promise<boolean> {
    if (!isAvailable()) return false
    try {
        const db = await openDB()
        const tx = db.transaction(STORE, 'readwrite')
        tx.objectStore(STORE).put(clampHistory(history))
        await new Promise<void>((resolve, reject) => {
            tx.oncomplete = () => resolve()
            tx.onerror = () => reject(tx.error || new Error('IDB save failed'))
            tx.onabort = () => reject(tx.error || new Error('IDB save aborted'))
        })
        return true
    }
    catch {
        return false
    }
}

export async function clearProject(projectId: string): Promise<boolean> {
    if (!isAvailable()) return false
    try {
        const db = await openDB()
        const tx = db.transaction(STORE, 'readwrite')
        tx.objectStore(STORE).delete(projectId)
        await new Promise<void>((resolve, reject) => {
            tx.oncomplete = () => resolve()
            tx.onerror = () => reject(tx.error || new Error('IDB delete failed'))
            tx.onabort = () => reject(tx.error || new Error('IDB delete aborted'))
        })
        return true
    }
    catch {
        return false
    }
}

// ---------------------------------------------------------------------------
// small helpers shared by the hook / pane

export function makeConversationId(): string {
    try {
        const c = globalThis.crypto as Crypto | undefined
        if (c?.randomUUID) return c.randomUUID()
    }
    catch { /* fall through */ }
    return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** Derive a short, human title from the first user message (first line, 70 chars). */
export function deriveConversationTitle(messages: StoredMessage[]): string {
    const first = messages.find(m => m.role === 'user')
    const raw = (first?.content || '').trim()
    const line = raw.split('\n')[0].replace(/\s+/g, ' ').trim()
    if (!line) return 'New chat'
    return line.length > 70 ? `${line.slice(0, 70).trimEnd()}…` : line
}
