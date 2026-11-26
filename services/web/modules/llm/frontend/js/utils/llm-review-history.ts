// overleaf-lab (2026-11, owner request: "the AI check history is still
// missing"): the AI check (compliance) pane was a one-shot runner — finished
// reviews VANISHED on reload. This is its persistent history: every completed
// review run is stored per-project (browser-side, fail-safe, capped) and can
// be re-opened, downloaded, deleted, or cleared.
//
// Storage: the SAME IndexedDB the chat histories use (ol-llm-chat-history)
// under its OWN key `${projectId}/review-runs`, so it can never mix with the
// assistant chat history (the assistant keeps the legacy bare key).
import type { ComplianceResult } from '../hooks/use-llm-compliance'

const DB_NAME = 'ol-llm-chat-history'
const DB_VERSION = 1
const STORE = 'projects'
// overleaf-lab: the run history keeps at most this many runs per project.
const MAX_RUNS = 20

export interface StoredReviewRun {
    id: string
    finishedAt: number
    // overleaf-lab: the FULL result (structured items, summary, model) is
    // stored, so a re-opened run renders EXACTLY like the live report and
    // downloads the same HTML report.
    result: ComplianceResult
    lane?: 'site' | 'user'
}

interface RunsRow {
    projectId: string
    activeId: string | null
    runs: StoredReviewRun[]
}

function keyOf(projectId: string): string {
    return `${projectId}/review-runs`
}

export function isAvailable(): boolean {
    try {
        return typeof indexedDB !== 'undefined' && indexedDB !== null
    }
    catch {
        return false
    }
}

let dbPromise: Promise<IDBDatabase> | null = null

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
                db.onversionchange = () => {
                    try {
                        db.close()
                    }
                    catch { /* already closing */ }
                }
                resolve(db)
            }
            request.onerror = () => reject(request.error || new Error('IDB open failed'))
            request.onblocked = () => reject(new Error('IDB open blocked'))
        })
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

function makeId(): string {
    try {
        const c = globalThis.crypto as Crypto | undefined
        if (c?.randomUUID) return c.randomUUID()
    }
    catch { /* fall through */ }
    return `run-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
}

export async function listRuns(projectId: string): Promise<StoredReviewRun[]> {
    if (!isAvailable() || !projectId) return []
    try {
        const db = await openDB()
        const value = await toPromise<RunsRow | undefined>(
            db.transaction(STORE, 'readonly').objectStore(STORE).get(keyOf(projectId)),
        )
        if (!value || !Array.isArray(value.runs)) return []
        return value.runs
            .slice()
            .sort((a, b) => b.finishedAt - a.finishedAt)
    }
    catch {
        return []
    }
}

export async function saveRun(projectId: string, result: ComplianceResult, lane?: 'site' | 'user'): Promise<StoredReviewRun | null> {
    if (!isAvailable() || !projectId) return null
    const run: StoredReviewRun = {
        id: makeId(),
        finishedAt: Date.now(),
        result,
        lane,
    }
    try {
        const db = await openDB()
        const tx = db.transaction(STORE, 'readwrite')
        const key = keyOf(projectId)
        const existing = await toPromise<RunsRow | undefined>(tx.objectStore(STORE).get(key))
        // overleaf-lab (2026-11, bug): the store has keyPath 'projectId', so
        // `put(value, explicitKey)` is ILLEGAL (it threw and the save died
        // silently in the catch). The store key MUST be the projectId field
        // value — set it to the composite scope key.
        const row: RunsRow = {
            projectId: key,
            activeId: run.id,
            runs: existing && Array.isArray(existing.runs) ? [run, ...existing.runs] : [run],
        }
        row.runs = row.runs.slice(0, MAX_RUNS)
        await toPromise(tx.objectStore(STORE).put(row))
        await new Promise<void>((resolve, reject) => {
            tx.oncomplete = () => resolve()
            tx.onerror = () => reject(tx.error || new Error('IDB save failed'))
            tx.onabort = () => reject(tx.error || new Error('IDB save aborted'))
        })
        return run
    }
    catch {
        return null
    }
}

export async function removeRun(projectId: string, runId: string): Promise<void> {
    if (!isAvailable() || !projectId) return
    try {
        const db = await openDB()
        const tx = db.transaction(STORE, 'readwrite')
        const key = keyOf(projectId)
        const existing = await toPromise<RunsRow | undefined>(tx.objectStore(STORE).get(key))
        if (!existing) return
        existing.runs = existing.runs.filter(r => r.id !== runId)
        if (existing.activeId === runId) existing.activeId = null
        // overleaf-lab: keyPath store — put() WITHOUT an explicit key (the
        // row's own projectId field IS the composite store key).
        await toPromise(tx.objectStore(STORE).put(existing))
    }
    catch { /* no-op storage */ }
}

export async function clearRuns(projectId: string): Promise<void> {
    if (!isAvailable() || !projectId) return
    try {
        const db = await openDB()
        await toPromise(db.transaction(STORE, 'readwrite').objectStore(STORE).delete(keyOf(projectId)))
    }
    catch { /* no-op storage */ }
}
