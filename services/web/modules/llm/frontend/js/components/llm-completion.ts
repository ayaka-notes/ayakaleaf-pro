// LLM Inline Completion for CodeMirror
// Adapted from lcpu-club/overleaf — provides ghost text inline suggestions
// Uses the module's /project/:id/llm/completion endpoint

import {
    Extension,
    StateEffect,
    StateField,
    EditorState,
    Prec,
} from '@codemirror/state'
import {
    EditorView,
    ViewPlugin,
    ViewUpdate,
    Decoration,
    DecorationSet,
    WidgetType,
    keymap,
} from '@codemirror/view'
import getMeta from '@/utils/meta'

// =================================================================================
// Types
// =================================================================================

export interface CompletionOptions {
    cursorOffset: number
    leftContext: string
    rightContext: string
    language: string
    maxLength: number
    fileList: string[]
    outline: string[]
}

type Suggestion = {
    from: number
    text: string
    preview: string
}

type LlmCompletionResult =
    | { kind: 'ok'; data: string }
    | { kind: 'aborted' }
    | { kind: 'error'; reason?: string; body?: any }

// =================================================================================
// Backend Service
// =================================================================================

class LlmCompletionService {
    async createCompletion(
        options: CompletionOptions,
        signal?: AbortSignal
    ): Promise<LlmCompletionResult> {
        try {
            const projectId = getMeta('ol-project_id')
            const csrfToken = getMeta('ol-csrfToken')

            const res = await fetch(`/project/${projectId}/llm/completion`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': csrfToken,
                },
                credentials: 'same-origin',
                body: JSON.stringify(options),
                signal,
            })

            let parsed: any
            try {
                parsed = await res.json()
            } catch {
                return { kind: 'error', reason: 'invalid-json' }
            }

            if (!res.ok) {
                return { kind: 'error', reason: 'http-error', body: parsed }
            }

            if (
                parsed &&
                typeof parsed === 'object' &&
                typeof parsed.success === 'boolean'
            ) {
                if (parsed.success && typeof parsed.data === 'string') {
                    return { kind: 'ok', data: parsed.data }
                } else {
                    return { kind: 'error', reason: 'backend-failure', body: parsed }
                }
            }

            return { kind: 'error', reason: 'unexpected-format', body: parsed }
        } catch (err: any) {
            if (err.name === 'AbortError') {
                return { kind: 'aborted' }
            }
            return { kind: 'error', reason: 'network-or-unknown' }
        }
    }
}

const llmCompletion = new LlmCompletionService()

// overleaf-lab (2026-11, owner request): per-user inline-completion toggle.
// Fetched once per page load ('' = not loaded yet; null = load failed ->
// stay active and let the server decide).
let userCompletionOn: boolean | null = null
let userPrefsPromise: Promise<boolean> | null = null

export function setInlineCompletionEnabled(value: boolean | null): void {
    userCompletionOn = value
    // Invalidate the in-flight fetch so the next trigger re-asks the server.
    if (value === null) userPrefsPromise = null
}

function inlineCompletionAllowed(projectId?: string): Promise<boolean> {
    if (userCompletionOn !== null) return Promise.resolve(userCompletionOn)
    if (!projectId) return Promise.resolve(true)
    if (!userPrefsPromise) {
        userPrefsPromise = fetch(`/user/llm/prefs`, { credentials: 'same-origin' })
            .then(r => (r.ok ? r.json() : null))
            .then(data => {
                const on = !!(data && data.completionEnabled !== false && data.ok !== false)
                userCompletionOn = on
                return on
            })
            .catch(() => {
                userPrefsPromise = null // retry next time
                return true // server unreachable: fall back to prior behaviour
            })
    }
    return userPrefsPromise
}

// =================================================================================
// State Management
// =================================================================================

const setSuggestionEffect = StateEffect.define<Suggestion | null>()

const suggestionField = StateField.define<Suggestion | null>({
    create: () => null,
    update(value, tr) {
        for (const e of tr.effects) {
            if (e.is(setSuggestionEffect)) return e.value
        }

        if (!value) return value
        if (tr.docChanged) {
            let changeCount = 0
            let isSimpleInsertion = true
            let insertedText = ''
            let changeFrom = -1

            tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
                changeCount++
                if (fromA !== toA || inserted.toString().includes('\n')) {
                    isSimpleInsertion = false
                }
                insertedText += inserted.toString()
                if (changeFrom === -1) changeFrom = fromA
            })

            const shouldUpdate =
                isSimpleInsertion &&
                changeCount === 1 &&
                changeFrom === value.from &&
                insertedText.length > 0 &&
                value.text.startsWith(insertedText)

            if (shouldUpdate) {
                const newText = value.text.slice(insertedText.length)
                if (newText.length > 0) {
                    const newFrom = value.from + insertedText.length
                    return {
                        from: newFrom,
                        text: newText,
                        preview: createPreview(newText),
                    }
                }
            }
            return null
        }

        if (
            tr.selection &&
            (!tr.selection.main.empty || tr.selection.main.from !== value.from)
        ) {
            return null
        }

        return value
    },
    provide: f => [
        EditorView.decorations.compute([f], state => {
            const suggestion = state.field(f)
            return suggestion
                ? renderGhostDecorations(suggestion, state)
                : Decoration.none
        }),
    ],
})

// =================================================================================
// UI Widgets & Decorations
// =================================================================================

class GhostTextWidget extends WidgetType {
    private static readonly MAX_PREVIEW_LINES = 3

    constructor(readonly text: string) {
        super()
    }

    eq(other: GhostTextWidget) {
        return this.text === other.text
    }

    toDOM() {
        const span = document.createElement('span')
        span.className = 'cm-ghostText'

        let text = this.text
        const lines = text.split('\n')
        if (lines.length > GhostTextWidget.MAX_PREVIEW_LINES) {
            text =
                lines.slice(0, GhostTextWidget.MAX_PREVIEW_LINES).join('\n') + '\n...'
        }

        span.textContent = text
        return span
    }
}

function renderGhostDecorations(
    s: Suggestion,
    _state: EditorState
): DecorationSet {
    return Decoration.set([
        Decoration.widget({
            widget: new GhostTextWidget(s.text),
            side: 1,
        }).range(s.from),
    ])
}

// =================================================================================
// Core Plugin Logic
// =================================================================================

class InlineCompletionPlugin {
    private view: EditorView

    private config = {
        language: 'latex',
        debounceMs: 1000,
        maxLeftLines: 10,
        maxRightLines: 2,
        maxLength: 60,
    }

    private debounceTimer: number | null = null
    private isActive = false
    private currentSuggestionPos = 0
    private requestAbortController: AbortController | null = null

    private requestSeq = 0
    private latestRequestId = 0
    private pendingRequestSeed: string | null = null
    private readonly seedLen = 50

    private isComposing = false
    private readonly compositionStartHandler: () => void
    private readonly compositionEndHandler: () => void

    constructor(view: EditorView) {
        this.view = view

        this.compositionStartHandler = () => {
            this.isComposing = true
        }
        this.compositionEndHandler = () => {
            this.isComposing = false
            if (typeof requestIdleCallback === 'function') {
                requestIdleCallback(
                    () => {
                        if (!this.isComposing) {
                            this.debounceTrigger()
                        }
                    },
                    { timeout: 500 }
                )
            } else {
                setTimeout(() => {
                    if (!this.isComposing) {
                        this.debounceTrigger()
                    }
                }, 200)
            }
        }
        this.setupCompositionListeners()
    }

    update(update: ViewUpdate) {
        if (this.isComposing || !update.state.selection.main.empty) {
            this.cancel('composing or selection not empty')
            return
        }

        if (update.selectionSet && this.isActive) {
            const suggestion = this.view.state.field(suggestionField, false)
            if (
                suggestion &&
                update.state.selection.main.from !== suggestion.from
            ) {
                this.cancel('cursor moved')
            }
        }

        if (shouldTriggerOnInsertion(update, 30)) {
            this.debounceTrigger()
        }
    }

    destroy() {
        this.teardownCompositionListeners()
        this.cancel('plugin destroyed')
    }

    private setupCompositionListeners() {
        this.view.dom.addEventListener(
            'compositionstart',
            this.compositionStartHandler
        )
        this.view.dom.addEventListener(
            'compositionend',
            this.compositionEndHandler
        )
    }

    private teardownCompositionListeners() {
        this.view.dom.removeEventListener(
            'compositionstart',
            this.compositionStartHandler
        )
        this.view.dom.removeEventListener(
            'compositionend',
            this.compositionEndHandler
        )
    }

    private debounceTrigger() {
        if (this.debounceTimer) clearTimeout(this.debounceTimer)
        this.debounceTimer = window.setTimeout(() => {
            this.trigger().catch(() => {
                // swallowed: the plugin surfaces its own error state
            })
        }, this.config.debounceMs)
    }

    triggerManual() {
        this.trigger().catch(() => {
            // swallowed: manual triggers surface errors through the placeholder
        })
    }

    private async trigger() {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer)
            this.debounceTimer = null
        }
        this.cancel('new request')

        if (this.isComposing) return

        // overleaf-lab (2026-11): the user switched inline completion off in
        // their editor settings — no requests at all.
        const projectId = getMeta('ol-project_id')
        if (!(await inlineCompletionAllowed(projectId))) return

        const pos = this.view.state.selection.main.head
        const { leftContext, rightContext } = computeContexts(
            this.view,
            pos,
            this.config.maxLeftLines,
            this.config.maxRightLines
        )

        this.isActive = true
        this.currentSuggestionPos = pos
        this.requestAbortController = new AbortController()

        const seedLines = 3
        const { leftContext: seedLeft, rightContext: seedRight } =
            computeContexts(this.view, pos, seedLines, seedLines)
        const seed =
            (seedLeft.slice(-this.seedLen) || '') +
            '|' +
            (seedRight.slice(0, this.seedLen) || '')
        this.pendingRequestSeed = seed
        const requestId = ++this.requestSeq
        this.latestRequestId = requestId

        const { filelist, outline } = this.collectProjectContext()
        const language = this.getCurrentFileLanguage()

        const result = await llmCompletion.createCompletion(
            {
                cursorOffset: pos,
                leftContext,
                rightContext,
                language,
                maxLength: this.config.maxLength,
                fileList: filelist,
                outline: outline,
            },
            this.requestAbortController.signal
        )

        if (result.kind === 'aborted' || requestId !== this.latestRequestId) {
            return
        }

        if (result.kind === 'error') {
            this.cancel('request error')
            return
        }

        if (
            !this.verifySeedAtPosition(
                this.currentSuggestionPos,
                this.pendingRequestSeed
            )
        ) {
            this.cancel('seed-mismatch')
            return
        }

        const completionText = result.data
        if (!completionText) {
            this.cancel('no-completion')
            return
        }

        if (
            this.view.state.selection.main.head !== this.currentSuggestionPos
        ) {
            this.cancel('cursor-moved-after-request')
            return
        }

        this.view.dispatch({
            effects: setSuggestionEffect.of({
                from: this.currentSuggestionPos,
                text: completionText,
                preview: createPreview(completionText),
            }),
        })
    }

    accept(): boolean {
        const suggestion = this.view.state.field(suggestionField, false)
        if (!suggestion) return false

        if (this.view.state.selection.main.head !== suggestion.from) {
            this.cancel('accept-failed-cursor-moved')
            return false
        }

        this.view.dispatch({
            changes: { from: suggestion.from, insert: suggestion.text },
            selection: { anchor: suggestion.from + suggestion.text.length },
            effects: setSuggestionEffect.of(null),
        })
        this.isActive = false
        return true
    }

    cancel(_reason?: string) {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer)
            this.debounceTimer = null
        }

        this.isActive = false
        this.pendingRequestSeed = null

        if (this.requestAbortController) {
            this.requestAbortController.abort()
            this.requestAbortController = null
        }

        if (this.view.state.field(suggestionField, false)) {
            this.view.dispatch({ effects: setSuggestionEffect.of(null) })
        }
    }

    private collectProjectContext() {
        if (typeof document === 'undefined')
            return { filelist: [], outline: [] }
        const filelist: string[] = []
        const outline: string[] = []
        try {
            document
                .querySelectorAll('.file-tree .entity-name')
                .forEach(el => {
                    const text = el.textContent?.trim()
                    if (text) filelist.push(text)
                })
            document
                .querySelectorAll('.outline-pane .outline-item')
                .forEach(el => {
                    const text = el.textContent?.trim()
                    if (text) outline.push(text)
                })
        } catch {
            // ignore
        }
        return { filelist, outline }
    }

    private getCurrentFileLanguage(): string {
        if (typeof document === 'undefined') return this.config.language
        try {
            const selectedItem = document.querySelector(
                '.file-tree li.selected span'
            )
            const fileName = selectedItem?.textContent?.trim() || ''
            const parts = fileName.split('.')
            if (parts.length > 1) {
                return parts.pop()!
            }
        } catch {
            // ignore
        }
        return this.config.language
    }

    private verifySeedAtPosition(
        pos: number,
        seed: string | null
    ): boolean {
        if (!seed) return false
        const seedLines = 3
        const { leftContext, rightContext } = computeContexts(
            this.view,
            pos,
            seedLines,
            seedLines
        )
        const currentSeed =
            (leftContext.slice(-this.seedLen) || '') +
            '|' +
            (rightContext.slice(0, this.seedLen) || '')
        return currentSeed === seed
    }
}

// =================================================================================
// Helpers
// =================================================================================

function createPreview(s: string, maxLines: number = 3): string {
    const lines = s.split('\n')
    if (lines.length <= maxLines) {
        return s
    }
    return lines.slice(0, maxLines).join('\n') + '\n...'
}

function computeContexts(
    view: EditorView,
    pos: number,
    maxLeftLines: number,
    maxRightLines: number
) {
    const doc = view.state.doc
    const currentLine = doc.lineAt(pos)

    const leftStartLine = Math.max(1, currentLine.number - maxLeftLines)
    const leftStartPos = doc.line(leftStartLine).from
    const leftContext = doc.sliceString(leftStartPos, pos)

    const rightEndLine = Math.min(
        doc.lines,
        currentLine.number + maxRightLines
    )
    const rightEndPos = doc.line(rightEndLine).to
    const rightContext = doc.sliceString(pos, rightEndPos)

    return { leftContext, rightContext }
}

function shouldTriggerOnInsertion(
    update: ViewUpdate,
    maxInsertThreshold: number
): boolean {
    if (!update.docChanged) return false

    let insertedTextLength = 0
    let isSimpleInsertion = true

    update.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
        const ins = inserted.toString()
        if (fromA !== toA || ins.includes('\n')) {
            isSimpleInsertion = false
        }
        insertedTextLength += ins.length
    })

    return (
        isSimpleInsertion &&
        insertedTextLength > 0 &&
        insertedTextLength <= maxInsertThreshold
    )
}

// =================================================================================
// Export
// =================================================================================

export const INLINE_COMPLETION_PLUGIN = ViewPlugin.define(
    (view: EditorView) => new InlineCompletionPlugin(view),
    {
        destroy: plugin => plugin.destroy(),
    }
)

// overleaf-lab: created once and reused by every instance (editor-theme rule).
const ghostTextTheme = EditorView.baseTheme({
    '.cm-ghostText': {
        opacity: '0.45',
        color: 'var(--cm-ghost-foreground, #888)',
        pointerEvents: 'none',
        fontFamily: 'inherit',
        fontSize: 'inherit',
        lineHeight: 'inherit',
        fontWeight: 'inherit',
        whiteSpace: 'pre-wrap',
        wordWrap: 'break-word',
        maxWidth: '100%',
        verticalAlign: 'baseline',
    },
})

export function inlineCompletionExtension(): Extension {
    return [
        suggestionField,
        INLINE_COMPLETION_PLUGIN,
        Prec.highest(
            keymap.of([
                {
                    key: 'Tab',
                    run: view => {
                        const plugin = view.plugin(INLINE_COMPLETION_PLUGIN)
                        if (plugin) {
                            const accepted = plugin.accept()
                            if (accepted) return true
                        }
                        return false // fall through to default Tab behaviour
                    },
                },
                {
                    key: 'Mod-Enter',
                    run: view => {
                        const plugin = view.plugin(INLINE_COMPLETION_PLUGIN)
                        return plugin ? plugin.accept() : false
                    },
                },
                {
                    key: 'Escape',
                    run: view => {
                        const plugin = view.plugin(INLINE_COMPLETION_PLUGIN)
                        if (plugin) {
                            plugin.cancel('escape key')
                            return true
                        }
                        return false
                    },
                },
                {
                    key: 'Mod-\\',
                    run: view => {
                        const plugin = view.plugin(INLINE_COMPLETION_PLUGIN)
                        if (plugin) {
                            plugin.triggerManual()
                            return true
                        }
                        return false
                    },
                },
            ])
        ),
        ghostTextTheme,
    ]
}
