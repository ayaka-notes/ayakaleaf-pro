// LLM Floating Toolbar for CodeMirror Editor
// Adapted from lcpu-club/overleaf — provides selection-based AI actions
// (paraphrase, style change, summarize, explain, etc.)

import React, {
    forwardRef,
    useEffect,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
} from 'react'
import { EditorView } from '@codemirror/view'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import getMeta from '@/utils/meta'
import { postJSON } from '@/infrastructure/fetch-json'
import MaterialIcon from '@/shared/components/material-icon'
import '../../stylesheets/llm-ui.scss'
import { useLLMFeatures } from '../hooks/use-llm-features'
import { useLLMPrompts } from '../hooks/use-llm-prompts'
import { watchEditorTheme } from '../utils/llm-editor-theme'

export type LLMToolbarHandle = {
    show: (view: EditorView) => void
    hide: () => void
    openMenu: () => void
    getSelectedText: () => string
}

type ParaphraseKind =
    | 'paraphrase'
    | 'style'
    | 'mathfix'
    | 'summarize'
    | 'explain'
    | 'translate'
    | 'synonyms'
    | 'checkCitations'
    | 'title'
    | 'abstract'
    | 'keywords'
    | 'chat'

const kindTitleMap: Record<ParaphraseKind, string> = {
    paraphrase: 'Paraphrase',
    style: 'Change Style',
    summarize: 'Summarize',
    explain: 'Explain',
    mathfix: 'Fix formula syntax',
    translate: 'Translate',
    synonyms: 'Synonyms',
    checkCitations: 'Check citations',
    title: 'Title Generator',
    abstract: 'Abstract Generator',
    keywords: 'Keyword Generator',
    chat: 'AI Response',
}

// overleaf-lab (2026-08, reference-synced): the context menu is now CONTEXT-
// SENSITIVE like the reference product: with a selection → text
// transformations (Rephrase / Shorten / More scientific / Translate→language /
// Synonyms / Check citations); without a selection → the whole-document
// generators (Title / Abstract / Keywords).
const TRANSLATE_LANGUAGES: string[] = [
    'Albanian',
    'Arabic',
    'Bulgarian',
    'Chinese (Simplified)',
    'Chinese (Traditional)',
    'Czech',
    'Dutch',
    'English',
    'Filipino',
    'French',
    'German',
    'Greek',
    'Hebrew',
    'Hindi',
    'Hungarian',
    'Indonesian',
    'Italian',
    'Japanese',
    'Korean',
    'Malay',
    'Persian (Farsi)',
    'Polish',
    'Portuguese',
    'Romanian',
    'Russian',
    'Serbian',
    'Spanish',
    'Swedish',
    'Turkish',
    'Ukrainian',
    'Vietnamese',
]

const askAiMenuKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        e.currentTarget.click()
    }
}

const AskAiMenuItem = ({
    icon,
    label,
    onClick,
}: {
    icon?: string
    label: string
    onClick: () => void
}) => (
    <div
        className="llm-item"
        onClick={onClick}
        role="menuitem"
        tabIndex={0}
        onKeyDown={askAiMenuKeyDown}
    >
        <span aria-hidden="true" className={icon ? undefined : 'llm-item-icon-spacer'}>
            {icon ? <MaterialIcon type={icon} /> : null}
        </span>
        {label}
    </div>
)

function escapeHtml(s: string) {
    return s.replace(
        /[&<>"']/g,
        c =>
        ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;',
        }[c] || c)
    )
}

function base64EncodeUnicode(str: string) {
    try {
        return btoa(unescape(encodeURIComponent(str)))
    } catch {
        return btoa(str)
    }
}

function base64DecodeUnicode(b64: string) {
    try {
        return decodeURIComponent(escape(atob(b64)))
    } catch {
        return atob(b64)
    }
}

const Spinner = () => (
    <div
        style={{
            width: 16,
            height: 16,
            borderRadius: 8,
            border: '2px solid rgba(255,255,255,0.12)',
            borderTopColor: 'rgba(255,255,255,0.7)',
            animation: 'llm-spin 0.9s linear infinite',
        }}
    />
)

const LLMToolbar = forwardRef<LLMToolbarHandle, Record<string, never>>((_, ref) => {
    // overleaf-lab: the floating "Ask AI" selection toolbar is part of the chat
    // feature, so it obeys the super-admin chat flag. Called unconditionally to
    // respect the rules of hooks; the returned JSX is gated further down.
    const features = useLLMFeatures()
    // overleaf-lab: admin-editable prompts. Called unconditionally at the top so
    // the rules of hooks hold. `prompts` is read directly inside postToAPI (a
    // closure recreated each render), falling back to the hardcoded strings when
    // a field is missing or the fetch has not resolved.
    const { prompts } = useLLMPrompts()
    const [anchorShown, setAnchorShown] = useState(false)
    const [panelRect, setPanelRect] = useState({ top: 0, left: 0, width: 520 })
    const [anchorPos, setAnchorPos] = useState({ top: 0, left: 0 })
    const [panelMode, setPanelMode] = useState<
        'hidden' | 'menu' | 'chat' | 'paraphrase'
    >('hidden')
    // overleaf-lab (owner feedback): the Translate language list is an INLINE
    // accordion inside the menu with a search filter — the old hover fly-out
    // opened far from the pointer and closed before it could be reached.
    const [translateOpen, setTranslateOpen] = useState(false)
    const [langQuery, setLangQuery] = useState('')
    // overleaf-lab (owner request 2026-08-26): the "Select LLM Model" menu item is
    // gone — that choice lives ONLY under File → "Select LLM Model" (the one
    // user-scoped selection used by every AI surface).

    // overleaf-lab (owner request 2026-08-25): this floating overlay follows
    // the EDITOR theme like the rail panel does.
    useEffect(() => {
        const watcher = watchEditorTheme([wrapRef.current])
        return () => watcher.stop()
    }, [])

    const [query, setQuery] = useState('')
    const [selectionText, setSelectionText] = useState('')
    const [selectionRange, setSelectionRange] = useState<{
        from: number
        to: number
    } | null>(null)
    const [result, setResult] = useState('')
    const [loading, setLoading] = useState(false)
    const [editMode, setEditMode] = useState(false)
    const [showDiff, setShowDiff] = useState(false)
    const [kind, setKind] = useState<ParaphraseKind>('paraphrase')

    const viewRef = useRef<EditorView | null>(null)
    // overleaf-lab: the imperative API (show/openMenu) captured each render so
    // the editor toolbar "Ask AI" button can open the context menu via event.
    const apiRef = useRef<{
        show: (view: EditorView) => void
        openMenu: () => void
        hide: () => void
        getSelectedText: () => string
    } | null>(null)
    const wrapRef = useRef<HTMLDivElement | null>(null)
    const panelRef = useRef<HTMLDivElement | null>(null)
    const inputRef = useRef<HTMLTextAreaElement | null>(null)
    const editRef = useRef<HTMLTextAreaElement | null>(null)

    const postToAPI = async (mode: number, ask: string, vars?: Record<string, string>) => {
        const projectId = getMeta('ol-project_id')

        // overleaf-lab: PR item 13 — title/abstract are document-level generators:
        // feed the whole current file (the toolbar's editor doc) instead of the
        // selection, keeping the selection as a fallback when the doc is empty.
        const wholeFileText = viewRef.current?.state?.doc?.toString?.() || ''
        const basisText =
            (mode === 9 || mode === 10) && wholeFileText ? wholeFileText : selectionText

        // Build a prompt based on the mode
        const modePrompts: Record<number, string> = {
            0: ask, // free-form chat
            1: `Paraphrase the following LaTeX text. Keep every LaTeX command, math, and citation key intact. Output only the paraphrased text, with no preamble, no explanation, and no code fences. Keep the output in the same language as the input text.\n\n${basisText}`,
            2: `Rewrite the following LaTeX text in fluent, formal academic English. Preserve every LaTeX command, math, and citation key. Output only the rewritten text, with no preamble and no code fences.\n\n${basisText}`,
            3: `Rewrite the following LaTeX text more concisely, preserving its meaning and every LaTeX command, math, and citation. Output only the rewritten text, nothing else. Keep the output in the same language as the input text.\n\n${basisText}`,
            4: `Rewrite the following LaTeX text in a punchier, more engaging style while keeping it accurate. Preserve every LaTeX command, math, and citation. Output only the rewritten text, nothing else. Keep the output in the same language as the input text.\n\n${basisText}`,
            5: `Split the following LaTeX paragraph into several shorter, well-structured paragraphs. Keep the wording and all LaTeX; only add paragraph breaks. Output only the resulting LaTeX, nothing else.\n\n${basisText}`,
            6: `Join the following LaTeX paragraphs into a single cohesive paragraph, preserving every LaTeX command, math, and citation. Output only the resulting paragraph, nothing else.\n\n${basisText}`,
            7: `Summarize the following LaTeX text concisely. Output only the summary as plain LaTeX, with no preamble and no code fences. Keep the output in the same language as the input text.\n\n${basisText}`,
            8: `Explain the following LaTeX text clearly and concisely for the author, in the same language as the text:\n\n${basisText}`,
            9: `Propose one concise, specific academic title for the following content, in the same language as the content. Output only the title text: no quotes, no label, no trailing period.\n\n${basisText}`,
            10: `Write a single self-contained academic abstract (about 150 to 250 words) for the following content, in the same language as the content. Output only the abstract text: no heading, no label, and no code fences.\n\n${basisText}`,
            11: `Fix ONLY the LaTeX/math syntax problems in the following selection (mismatched braces or delimiters, invalid operators, wrong or missing math environments). Preserve the meaning and wording exactly, including the original language of any prose. Output only the corrected LaTeX, with no preamble, no explanation, and no code fences.\n\n${basisText}`,
            12: `Translate the following LaTeX text into {{language}}. Keep every LaTeX command, math, and citation key exactly as-is (translate only the natural-language text). Output only the translated text, with no preamble and no code fences.\n\n${basisText}`,
            13: `Suggest two or three well-chosen academic synonyms or phrasings for each key content word in the following LaTeX text, one per line, in the format "word — alternative(s)". Keep every LaTeX command intact and do not rewrite the whole text. Reply in the same language as the input text. Output only the list, with no preamble and no code fences.\n\n${basisText}`,
            14: `Check the citations in the following LaTeX selection (\\cite, \\citep, \\citet and similar). Report, only if there is a problem: malformed or suspicious bibliography keys, duplicate keys, or missing keys. If everything looks fine, reply exactly: OK. Keep the answer short and specific, in the same language as the text.\n\n${basisText}`,
        }

        // overleaf-lab: numeric transform modes map to admin action keys. Mode 0
        // is free-form chat and has no template.
        const modeActionKey: Record<number, string> = {
            1: 'paraphrase',
            2: 'academic',
            3: 'concise',
            4: 'punchy',
            5: 'split',
            6: 'join',
            7: 'summarize',
            8: 'explain',
            9: 'title',
            10: 'abstract',
            11: 'mathFix',
            12: 'translate',
            13: 'synonyms',
            14: 'checkCitations',
        }

        // overleaf-lab: hardcoded system prompt kept verbatim as the fallback
        // used whenever the admin prompt is absent or the fetch has not resolved.
        const fallbackSystemPrompt =
            'You are a LaTeX writing assistant embedded in an editor. Preserve existing LaTeX commands, math, and citation keys exactly, and reply in the same language as the input. When asked to rewrite or transform text, return only the resulting text, with no preamble and no Markdown code fences.'

        // overleaf-lab: prefer the admin system prompt when it is a non-empty
        // string, otherwise keep the hardcoded one.
        const systemContent =
            typeof prompts?.askAiSystemPrompt === 'string' &&
                prompts.askAiSystemPrompt.trim() !== ''
                ? prompts.askAiSystemPrompt
                : fallbackSystemPrompt

        // overleaf-lab: build the user content. Mode 0 stays free-form chat
        // (uses the user's `ask`). Transform modes prefer the admin template,
        // substituting the literal {{selection}} with the selected text (or
        // appending it when the template omits the placeholder), and fall back
        // to the hardcoded modePrompts entry when no admin template exists.
        let userContent: string
        const fillVars = (template: string, base: string) => {
            let out = template.includes('{{selection}}')
                ? template.split('{{selection}}').join(base)
                : template
            for (const [key, value] of Object.entries(vars || {})) {
                out = out.split(`{{${key}}}`).join(value)
            }
            return out
        }
        if (mode >= 1) {
            const actionKey = modeActionKey[mode]
            const template = actionKey
                ? prompts?.askAiActionPrompts?.[actionKey]
                : undefined
            if (typeof template === 'string' && template.trim() !== '') {
                userContent = template.includes('{{selection}}')
                    ? fillVars(template, basisText)
                    : `${template}\n\n${basisText}`
            } else {
                userContent = fillVars(modePrompts[mode] || ask, basisText)
            }
        } else {
            // overleaf-lab: PR item 10 — when the user asks while a passage is
            // selected, anchor the request to that passage (with its line range
            // when resolvable) so the reply can refer back to it, Overleaf-style.
            if (selectionText) {
                userContent = `<selected-text${selectionRef ? ` lines="${selectionRef}"` : ''}>\n${selectionText}\n</selected-text>\n\n${ask}`
            } else {
                userContent = modePrompts[mode] || ask
            }
        }

        const messages = [
            {
                role: 'system',
                content: systemContent,
            },
            {
                role: 'user',
                content: userContent,
            },
        ]

        // overleaf-lab (owner decision 2026-08-26): the request carries NO
        // explicit model — the backend resolves the user's profile selection
        // (File → "Select LLM Model") itself, so every surface always runs on
        // exactly the user's chosen model (no stale local bridge values).
        try {
            const json = await postJSON('/project/' + projectId + '/llm/chat', {
                body: { messages },
            })
            if (json && typeof json.content === 'string') {
                return json.content
            }
            throw new Error((json && json.message) || 'Unexpected response format')
        } catch (err: any) {
            return `Error: ${err?.data?.message || err?.data?.details || err?.message || 'Request failed'}`
        }
    }

    const startFetch = async (
        mode: number,
        k: ParaphraseKind,
        ask?: string,
        vars?: Record<string, string>
    ) => {
        setKind(k)
        setPanelMode(k === 'chat' ? 'chat' : 'paraphrase')
        setLoading(true)
        setEditMode(false)
        setShowDiff(false)
        setResult('')

        const resp = await postToAPI(mode, (ask ?? query).trim(), vars)
        setResult(resp)
        setLoading(false)
    }

    const renderer = useMemo(() => {
        const r = new marked.Renderer()
        r.code = (
            code: string,
            infostring: string | undefined,
            _escaped: boolean
        ) => {
            const lang = (infostring || '').trim().toLowerCase()
            const isLatex =
                lang === 'latex' ||
                lang === 'tex' ||
                code.trim().startsWith('\\')
            const safeCodeHtml = escapeHtml(code)
            if (isLatex) {
                const b64 = base64EncodeUnicode(code)
                return `<div class="llm-latex-block" style="position:relative;"><button class="llm-copy-latex" data-code="${b64}" title="Copy LaTeX" style="position:absolute;right:8px;top:8px;border-radius:6px;padding:4px 6px;border:none;background:rgba(255,255,255,0.03);color:#e6eef8;cursor:pointer">Copy</button><pre style="margin:0;"><code class="language-${escapeHtml(lang)}">${safeCodeHtml}</code></pre></div>`
            }
            return `<pre><code class="language-${escapeHtml(lang)}">${safeCodeHtml}</code></pre>`
        }
        return r
    }, [])

    const renderedHtml = useMemo(() => {
        try {
            // overleaf-lab: F3 — LLM output is attacker-influenceable via document
            // content, so the marked output is sanitized before being injected into
            // the page. The whitelist keeps the custom LaTeX-block markup (class,
            // style, data-code, title) that the copy button depends on.
            const html = marked.parse(result || 'No result yet.', { renderer }) as string
            return DOMPurify.sanitize(html, {
                ADD_ATTR: ['data-code'],
                USE_PROFILES: { html: true, svg: false, mathMl: false },
            })
        } catch {
            return escapeHtml(result || 'No result yet.')
        }
    }, [result, renderer])

    // Copy button delegation
    useEffect(() => {
        const root = wrapRef.current
        if (!root) return
        const handler = (e: MouseEvent) => {
            const target = e.target as HTMLElement
            const btn = target.closest
                ? (target.closest('.llm-copy-latex') as HTMLElement | null)
                : null
            if (!btn) return
            const b64 = btn.getAttribute('data-code')
            if (!b64) return
            const code = base64DecodeUnicode(b64)
                ; (async () => {
                    try {
                        await navigator.clipboard.writeText(code)
                        const prev = btn.innerText
                        btn.innerText = 'OK'
                        setTimeout(() => {
                            btn.innerText = prev
                        }, 900)
                    } catch {
                        btn.innerText = '!'
                        setTimeout(() => {
                            btn.innerText = 'Copy'
                        }, 900)
                    }
                })()
        }
        root.addEventListener('click', handler)
        return () => root.removeEventListener('click', handler)
    }, [])

    useImperativeHandle(ref, () => {
        const api = {
        // overleaf-lab (owner bug report #6): `preSelection` carries the
        // selection captured by the trigger at pointer-down — authoritative
        // even when the click already cleared the editor's live selection.
        show: (view: EditorView, preSelection?: { text: string; range: { from: number; to: number } } | null) => {
            viewRef.current = view
            const live = view.state.selection.main
            let sel = live
            let selText = live.empty ? '' : view.state.sliceDoc(live.from, live.to)
            if (selText === '' && preSelection && preSelection.text) {
                sel = { from: preSelection.range.from, to: preSelection.range.to, empty: false }
                selText = preSelection.text
            }
            const isEmpty = !selText
            if (isEmpty) {
                const containerW = wrapRef.current?.getBoundingClientRect()?.width ?? window.innerWidth
                const width = Math.max(320, Math.min(560, containerW - 24))
                setPanelRect({ top: 12, left: Math.round(containerW - width - 12), width })
                setSelectionText('')
                setSelectionRange(null)
                setAnchorShown(false)
                setPanelMode('hidden')
                document.dispatchEvent(
                    new CustomEvent('llm-toolbar-active', { detail: { active: true } })
                )
                // the toolbar button's caller immediately opens the menu
                return
            }

            const wrapRect = wrapRef.current?.getBoundingClientRect()
            const editorRect = view.dom.getBoundingClientRect()
            const coordsFrom = view.coordsAtPos(sel.from)
            const coordsTo = view.coordsAtPos(sel.to)
            const toLocal = (c: { left: number; top: number }) => ({
                x: wrapRect ? c.left - wrapRect.left : c.left,
                y: wrapRect ? c.top - wrapRect.top : c.top,
            })

            let aTop = 0,
                aLeft = 0
            if (coordsFrom && coordsTo) {
                const top = Math.min(coordsFrom.top, coordsTo.top)
                const bottom = Math.max(coordsFrom.bottom, coordsTo.bottom)
                const right = Math.max(coordsFrom.right, coordsTo.right)
                const midY = top + (bottom - top) / 2
                aTop = toLocal({ left: 0, top: midY }).y - 14
                aLeft = toLocal({ left: right, top: 0 }).x - 14
            } else {
                aTop =
                    editorRect.top +
                    editorRect.height / 2 -
                    (wrapRect?.top ?? 0) -
                    14
                aLeft = editorRect.right - (wrapRect?.left ?? 0) - 44
            }

            const containerW = wrapRect?.width ?? window.innerWidth
            const containerH = wrapRect?.height ?? window.innerHeight
            const clampedTop = Math.round(
                Math.max(8, Math.min(containerH - 44, aTop))
            )
            const clampedLeft = Math.round(
                Math.max(8, Math.min(containerW - 44, aLeft))
            )

            const width = Math.max(320, Math.min(560, containerW - 24))
            const panelTop = Math.round(
                Math.max(
                    12,
                    Math.min(
                        (wrapRect ? editorRect.top - wrapRect.top : 0) + 52,
                        containerH - 260 - 12
                    )
                )
            )
            const panelLeft = Math.round(
                Math.max(
                    12,
                    Math.min(
                        containerW - width - 12,
                        (wrapRect ? editorRect.left - wrapRect.left : 0) +
                        editorRect.width / 2 -
                        width / 2
                    )
                )
            )

            setPanelRect({ top: panelTop, left: panelLeft, width })
            setAnchorPos({ top: clampedTop, left: clampedLeft })
            setSelectionText(selText)
            setSelectionRange(isEmpty ? null : { from: sel.from, to: sel.to })
            setAnchorShown(true)
            setPanelMode('hidden')
            document.dispatchEvent(
                new CustomEvent('llm-toolbar-active', { detail: { active: true } })
            )
        },
        hide: () => {
            setAnchorShown(false)
            setPanelMode('hidden')
            setTranslateOpen(false)
            setLangQuery('')
            document.dispatchEvent(
                new CustomEvent('llm-toolbar-active', { detail: { active: false } })
            )
        },
        openMenu: () => {
            setAnchorShown(true)
            setPanelMode('menu')
        },
        getSelectedText: () => selectionText,
        }
        apiRef.current = api
        return api
    })

    // overleaf-lab (2026-08): the editor toolbar "Ask AI" button (a module in
    // sourceEditorToolbarStartButtons, rendered outside this React tree) asks
    // for the context menu via this document event, passing its view.
    useEffect(() => {
        const handler = (e: Event) => {
            const detail = (e as CustomEvent).detail || {}
            const view = detail.view as EditorView | undefined
            if (!view) return
            const pre = typeof detail.text === 'string' && detail.text.length > 0
                ? { text: detail.text as string, range: detail.range?.from != null ? { from: detail.range.from, to: detail.range.to } : { from: 0, to: 0 } }
                : null
            apiRef.current?.show(view, pre)
            apiRef.current?.openMenu()
        }
        document.addEventListener('ol-llm-open-ask-ai', handler)
        return () => document.removeEventListener('ol-llm-open-ask-ai', handler)
    }, [])

    // overleaf-lab (owner bug report #6): context sensitivity is decided at
    // OPEN time from the selection captured by the trigger (pointer-down,
    // before blur). No runtime re-derivation: interacting with the menu itself
    // must not flip between the two item sets mid-navigation.

    useEffect(() => {
        if (panelMode !== 'hidden') {
            requestAnimationFrame(() =>
                inputRef.current?.focus({ preventScroll: true } as any)
            )
        }
    }, [panelMode])

    const onInputKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            startFetch(0, 'chat')
        } else if (e.key === 'Escape') {
            setPanelMode('hidden')
            setAnchorShown(false)
        }
    }

    const replaceSelectionWith = (text: string) => {
        const view = viewRef.current
        const r = selectionRange
        if (!view || !r) return
        view.dispatch({ changes: { from: r.from, to: r.to, insert: text } })
        setPanelMode('hidden')
        setAnchorShown(false)
        setResult('')
        setQuery('')
    }

    const insertCodeAfterSelection = (text: string) => {
        const view = viewRef.current
        const r = selectionRange
        if (!view || !r) return

        // Extract LaTeX from markdown
        const extractLatex = (md: string) => {
            if (!md) return ''
            let m: RegExpExecArray | null
            let collected = ''

            const fencedLangRegex = /```\s*(?:latex|tex)\n([\s\S]*?)```/gi
            while ((m = fencedLangRegex.exec(md)) !== null)
                collected += m[1].trim() + '\n'
            if (collected) return collected.trim()

            const fencedAny = /```(?:\w+)?\n([\s\S]*?)```/g
            while ((m = fencedAny.exec(md)) !== null) {
                const code = m[1]
                if (/\\begin\{|\\[a-zA-Z]+|\\frac\{|\\end\{/.test(code))
                    collected += code.trim() + '\n'
            }
            if (collected) return collected.trim()

            return md.trim()
        }

        const code = extractLatex(text)
        const toInsert = code ? '\n' + code + '\n' : '\n' + text + '\n'
        view.dispatch({ changes: { from: r.to, to: r.to, insert: toInsert } })
        setPanelMode('hidden')
        setAnchorShown(false)
        setQuery('')
    }

    const copyToClipboard = async (t: string) => {
        try {
            await navigator.clipboard.writeText(t)
        } catch {
            // ignore
        }
    }

    const kindToMode: Record<ParaphraseKind, number> = {
        paraphrase: 1,
        style: 2,
        mathfix: 11,
        summarize: 7,
        explain: 8,
        translate: 12,
        synonyms: 13,
        checkCitations: 14,
        title: 9,
        abstract: 10,
        keywords: 0, // overleaf-lab: whole-document generator (see startGenerate)
        chat: 0,
    }

    // overleaf-lab: PR item 13 — whole-document generators (title / abstract /
    // keywords). These do NOT use the selection: the backend reads the full
    // project source (POST /project/:id/llm/generate) and returns the finished
    // text, which renders in the same result panel with copy/edit and Insert.
    const startGenerate = async (
        k: 'title' | 'abstract' | 'keywords'
    ) => {
        const projectId = getMeta('ol-project_id')
        setKind(k)
        setPanelMode('paraphrase')
        setLoading(true)
        setEditMode(false)
        setShowDiff(false)
        setResult('')
        try {
            const data = await postJSON<{
                ok?: boolean
                output?: string
                error?: string
                message?: string
            }>('/project/' + projectId + '/llm/generate', { body: { type: k } })
            if (data && data.ok) {
                setResult(String(data.output || ''))
            }
            else {
                setResult(`Generation failed: ${(data && (data.message || data.error)) || 'Unknown error'}`)
            }
        } catch (err: any) {
            setResult(`Generation failed: ${err?.data?.message || err?.data?.detail || err?.message || 'Request failed'}`)
        } finally {
            setLoading(false)
        }
    }

    const contentMaxHeight = Math.max(
        140,
        Math.round(window.innerHeight * 0.5)
    )

    // overleaf-lab: PR item 10 — human-readable reference to the current selection
    // (line range when resolvable). Shown as a chip above the "Ask AI" input and
    // embedded as <selected-text lines="..."> in the outgoing request.
    let selectionRef = ''
    if (selectionText && selectionRange && viewRef.current) {
        try {
            const from = viewRef.current.state.doc.lineAt(selectionRange.from)
            const to = viewRef.current.state.doc.lineAt(selectionRange.to)
            selectionRef = `${from.number}\u2013${to.number}`
        } catch {
            selectionRef = ''
        }
    }
    const selectionChip = selectionText
        ? `Selection: ${selectionText.length} chars${selectionRef ? `, lines ${selectionRef}` : ''}`
        : ''

    // overleaf-lab: once the flags load, if chat is disabled for this project the
    // toolbar must never surface its anchor/menu/panels. Render the same inert
    // fixed container it shows when there is no selection, so nothing appears.
    if (features.loaded && features.chatEnabled === false) {
        return (
            <div
                ref={wrapRef}
                style={{
                    position: 'absolute',
                    inset: 0,
                    pointerEvents: 'none',
                    zIndex: 9999,
                }}
            />
        )
    }

    return (
        <div
            ref={wrapRef}
            className="llm-wf-editor-scoped"
            style={{
                position: 'absolute',
                inset: 0,
                pointerEvents: 'none',
                zIndex: 9999,
            }}
        >
            <style>{`@keyframes llm-spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}
        /* overleaf-lab: upstream-AI (writefull-style) palette — off-white card /
           navy-slate dark panel, navy accent (tokens from llm-ui.scss) */
        .llm-anchor{position:absolute;width:28px;height:28px;border-radius:999px;background:var(--wf-accent,#28518f);color:#fff;font-weight:700;font-size:12px;display:inline-flex;align-items:center;justify-content:center;box-shadow:0 6px 22px rgba(2,6,23,0.35);cursor:pointer;pointer-events:auto}
        .llm-anchor:hover{background:var(--wf-accent-hi,#214475)}
        .llm-panel{position:absolute;pointer-events:auto;user-select:none}
        .llm-input-card{width:100%;display:flex;flex-direction:column;gap:6px;background:var(--wf-panel-bg,#fafafa);border-radius:12px;padding:10px;box-shadow:var(--wf-panel-shadow,0 10px 30px rgba(2,8,20,0.12));border:1px solid var(--wf-panel-border,#e3e8ef);color:var(--wf-panel-text,#1e293b)}
        .llm-ask-meta{font-size:11.5px;color:var(--wf-muted,#8fa2bd);padding:2px 4px}
        .llm-ask-row{display:flex;align-items:center;gap:8px}
        .llm-ask-icon{display:inline-flex;color:var(--wf-accent,#28518f);flex:0 0 auto}
        .llm-input{flex:1;min-height:36px;max-height:150px;padding:7px 10px;border-radius:8px;background:transparent;color:var(--wf-panel-text,#1e293b);border:1px solid var(--wf-border-in,#dfe5ec);outline:none;resize:none;line-height:18px;font-size:14px;box-sizing:border-box}
        .llm-input:focus{border-color:var(--wf-accent,#28518f)}
        .llm-send{width:32px;height:32px;flex:0 0 32px;border-radius:8px;background:var(--wf-accent,#28518f);border:1px solid var(--wf-accent,#28518f);color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer}
        .llm-send:hover{background:var(--wf-accent-hi,#214475)}
        .llm-close{width:32px;height:32px;flex:0 0 32px;border-radius:8px;background:transparent;border:1px solid var(--wf-border-in,#dfe5ec);color:var(--wf-panel-text,#1e293b);font-size:18px;line-height:1;display:flex;align-items:center;justify-content:center;cursor:pointer}
        .llm-close:hover{background:var(--wf-row-hover,#eef1f5)}
        .llm-menu{background:var(--wf-panel-bg,#fafafa);border-radius:12px;padding:8px;color:var(--wf-panel-text,#1e293b);border:1px solid var(--wf-panel-border,#e3e8ef);box-shadow:var(--wf-panel-shadow,0 10px 30px rgba(2,8,20,0.12))}
        .llm-item{min-height:40px;display:flex;align-items:center;gap:10px;padding:0 10px;border-radius:8px;cursor:pointer;color:var(--wf-panel-text,#1e293b)}
        .llm-item:hover{background:var(--wf-row-hover,#eef1f5)}
        .llm-item .material-symbols{font-size:18px;color:var(--wf-accent,#28518f);flex:0 0 auto}
        /* overleaf-lab (2026-08): keep labels aligned when an item has no icon
           (e.g. the Translate language submenu). */
        .llm-item-icon-spacer{width:18px;flex:0 0 auto;display:inline-block}
        .llm-item-chevron{margin-left:auto;color:var(--wf-muted,#8fa2bd)}
        .llm-menu-divider{height:1px;background:var(--wf-border-in,#dfe5ec);margin:6px 4px}
        /* overleaf-lab (owner feedback): Translate languages are an INLINE
           accordion with a search field — reachable, never closes early, and
           no hunting for a fly-out sub-menu. */
        .llm-translate-sub{margin:2px 2px 6px 28px;padding:4px;border:1px solid var(--wf-border-in,#dfe5ec);border-radius:8px;display:flex;flex-direction:column;gap:2px}
        .llm-lang-search{margin:0 2px 4px 2px;padding:5px 8px;font-size:12.5px;border:1px solid var(--wf-border-in,#dfe5ec);border-radius:6px;background:var(--wf-row-hi,#fff);color:var(--wf-panel-text,#1e293b);outline:none}
        .llm-lang-search:focus{border-color:var(--wf-accent,#28518f)}
        .llm-lang-list{max-height:190px;overflow-y:auto;display:flex;flex-direction:column;gap:1px}
        .llm-lang-list .llm-item{min-height:30px;font-size:13px}
        .llm-lang-empty{padding:8px 10px;font-size:12.5px;color:var(--wf-muted,#8fa2bd)}
        .llm-anchor .material-symbols{font-size:15px}
        .llm-paraphrase-card{pointer-events:auto;width:100%;background:var(--wf-panel-bg,#fafafa);border-radius:12px;padding:12px;box-shadow:var(--wf-panel-shadow,0 10px 30px rgba(2,8,20,0.12));border:1px solid var(--wf-panel-border,#e3e8ef);color:var(--wf-panel-text,#1e293b)}
        .llm-paraphrase-footer{display:flex;justify-content:flex-end;gap:10px;margin-top:10px}
        .llm-btn{padding:8px 12px;border-radius:8px;cursor:pointer;border:1px solid var(--wf-border-in,#dfe5ec);background:var(--wf-row-hi,#fff);color:var(--wf-panel-text,#1e293b)}
        .llm-btn:hover{background:var(--wf-row-hover,#eef1f5)}
        .llm-btn.llm-primary{background:var(--wf-accent,#28518f);border:1px solid var(--wf-accent,#28518f);color:#fff}
        .llm-btn.llm-primary:hover{background:var(--wf-accent-hi,#214475)}
        .llm-result-html{overflow-x:hidden;word-wrap:break-word;word-break:break-word;overflow-wrap:anywhere;color:var(--wf-panel-text,#1e293b)}
        .llm-result-html h1,.llm-result-html h2,.llm-result-html h3{color:var(--wf-panel-text,#1e293b);margin:6px 0}
        .llm-result-html p,.llm-result-html li{color:var(--wf-panel-text,#1e293b);margin:4px 0}
        .llm-result-html pre{background:var(--wf-code-bg,#f1f4f8);padding:8px;border-radius:6px;overflow-x:auto;color:var(--wf-panel-text,#1e293b);white-space:pre-wrap;word-wrap:break-word;max-width:100%}
        .llm-result-html code{word-wrap:break-word;white-space:pre-wrap}
        .llm-result-html code{background:var(--wf-code-bg,#f1f4f8);padding:1px 4px;border-radius:4px}
      `}</style>

            {/* Circular AI anchor button - visible after selection */}
            {anchorShown && panelMode === 'hidden' && !loading && (
                <button
                    className="llm-anchor"
                    style={{ top: anchorPos.top, left: anchorPos.left }}
                    onClick={() => setPanelMode('menu')}
                    title="AI"
                    aria-label="Ask AI (selection)"
                >
                    <MaterialIcon type="smart_toy" style={{ fontSize: 15 }} />
                </button>
            )}

            {/* Menu panel */}
            {anchorShown && panelMode === 'menu' && (
                <div
                    ref={panelRef}
                    className="llm-panel"
                    style={{
                        top: panelRect.top,
                        left: panelRect.left,
                        width: panelRect.width,
                    }}
                >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {/* overleaf-lab (owner 2026-08, upstream reference):
                            single ask row — smart_toy mark, free-form input,
                            send icon; the selection chip is a quiet meta line
                            above it (no more 'AI' text badge). */}
                        <div className="llm-input-card">
                            {selectionChip ? (
                                <div className="llm-ask-meta">{selectionChip}</div>
                            ) : null}
                            <div className="llm-ask-row">
                                <span className="llm-ask-icon" aria-hidden="true">
                                    <MaterialIcon type="smart_toy" style={{ fontSize: 20 }} />
                                </span>
                                <textarea
                                    ref={inputRef}
                                    className="llm-input"
                                    placeholder="Ask AI for help with anything"
                                    value={query}
                                    onChange={e => setQuery(e.target.value)}
                                    onKeyDown={onInputKeyDown}
                                    rows={1}
                                />
                                <button
                                    className="llm-send"
                                    onClick={() => startFetch(0, 'chat')}
                                    title="Send"
                                    aria-label="Send"
                                >
                                    <MaterialIcon type="send" style={{ fontSize: 17 }} />
                                </button>
                                <button
                                    className="llm-close"
                                    onClick={() => {
                                        setPanelMode('hidden')
                                        setAnchorShown(false)
                                    }}
                                    title="Close"
                                    aria-label="Close"
                                >
                                    ×
                                </button>
                            </div>
                        </div>

                        <div
                            className="llm-menu"
                            style={{ width: Math.min(220, panelRect.width - 36) }}
                            role="menu"
                        >
                            {selectionText ? (
                                <>

                                    <AskAiMenuItem icon="transform" label="Rephrase" onClick={() => startFetch(1, 'paraphrase')} />
                                    <AskAiMenuItem icon="text_fields" label="Shorten" onClick={() => startFetch(3, 'style')} />
                                    <AskAiMenuItem icon="school" label="More scientific" onClick={() => startFetch(2, 'style')} />
                                    <AskAiMenuItem icon="translate" label="Translate" onClick={() => setTranslateOpen(v => !v)} />
                                    {translateOpen && (
                                        <div className="llm-translate-sub">
                                            <input
                                                className="llm-lang-search"
                                                type="search"
                                                placeholder="Search language…"
                                                value={langQuery}
                                                onChange={e => setLangQuery(e.target.value)}
                                                onClick={e => e.stopPropagation()}
                                            />
                                            <div className="llm-lang-list">
                                                {TRANSLATE_LANGUAGES
                                                    .filter(l => l.toLowerCase().includes(langQuery.trim().toLowerCase()))
                                                    .map(lang => (
                                                        <AskAiMenuItem
                                                            key={lang}
                                                            icon=""
                                                            label={lang}
                                                            onClick={() => {
                                                                setTranslateOpen(false)
                                                                setLangQuery('')
                                                                startFetch(12, 'translate', undefined, { language: lang })
                                                            }}
                                                        />
                                                    ))}
                                                {TRANSLATE_LANGUAGES.filter(l => l.toLowerCase().includes(langQuery.trim().toLowerCase())).length === 0 && (
                                                    <div className="llm-lang-empty">No matching language</div>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                    <div className="llm-menu-divider" role="separator" />
                                    <AskAiMenuItem icon="search" label="Synonyms" onClick={() => startFetch(13, 'synonyms')} />
                                </>
                            ) : (
                                <>
                                    {/* overleaf-lab (reference-synced): nothing selected —
                                        whole-document generators (like the reference menu) */}
                                    <AskAiMenuItem icon="password" label="Title Generator" onClick={() => startGenerate('title')} />
                                    <AskAiMenuItem icon="subject" label="Abstract Generator" onClick={() => startGenerate('abstract')} />
                                    <AskAiMenuItem icon="label" label="Keywords Generator" onClick={() => startGenerate('keywords')} />
                                </>
                            )}

                        </div>
                    </div>
                </div>
            )}

            {/* Chat panel */}
            {anchorShown && panelMode === 'chat' && (
                <div
                    ref={panelRef}
                    className="llm-panel"
                    style={{
                        top: panelRect.top,
                        left: panelRect.left,
                        width: panelRect.width,
                    }}
                >
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        <div className="llm-input-card">
                            <div className="llm-badge">AI</div>
                            {selectionChip ? (
                                <div
                                    style={{
                                        width: "100%",
                                        fontSize: 11,
                                        color: 'var(--wf-muted, #8fa2bd)',
                                        background: 'var(--wf-row-hover, rgba(125,125,125,0.12))',
                                        borderRadius: 6,
                                        padding: "4px 8px",
                                        boxSizing: "border-box",
                                    }}
                                >
                                    {selectionChip}
                                </div>
                            ) : null}
                            <textarea
                                ref={inputRef}
                                className="llm-input"
                                placeholder="Ask AI for help"
                                value={query}
                                onChange={e => setQuery(e.target.value)}
                                onKeyDown={onInputKeyDown}
                                rows={1}
                            />
                            <button
                                className="llm-send"
                                onClick={() => startFetch(0, 'chat')}
                                title="Send"
                            >
                                ↑
                            </button>
                            <button
                                className="llm-close"
                                onClick={() => {
                                    setPanelMode('hidden')
                                    setAnchorShown(false)
                                    setQuery('')
                                }}
                                title="Close"
                            >
                                ×
                            </button>
                        </div>

                        <div className="llm-paraphrase-card">
                            <div style={{ fontSize: 13, color: 'var(--wf-muted, #9fb0c6)' }}>
                                {kindTitleMap['chat']}
                            </div>

                            {loading ? (
                                <div
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        padding: 24,
                                    }}
                                >
                                    <Spinner />
                                    <div style={{ marginLeft: 10, color: 'var(--wf-muted, #9aa4b2)' }}>
                                        Waiting for AI...
                                    </div>
                                </div>
                            ) : (
                                <>
                                    <div
                                        style={{
                                            minHeight: 88,
                                            maxHeight: contentMaxHeight,
                                            overflowY: 'auto',
                                            overflowX: 'hidden',
                                            paddingRight: 8,
                                        }}
                                    >
                                        <div
                                            className="llm-result-html"
                                            dangerouslySetInnerHTML={{ __html: renderedHtml }}
                                        />
                                    </div>

                                    <div className="llm-paraphrase-footer">
                                        <button
                                            className="llm-btn llm-primary"
                                            onClick={() => {
                                                setPanelMode('hidden')
                                                setQuery('')
                                                setResult('')
                                            }}
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            className="llm-btn llm-primary"
                                            onClick={() => insertCodeAfterSelection(result)}
                                            disabled={!result}
                                        >
                                            Insert
                                        </button>
                                        <button
                                            className="llm-btn llm-primary"
                                            onClick={() => startFetch(0, 'chat')}
                                            disabled={loading || !query.trim()}
                                        >
                                            Regenerate
                                        </button>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Paraphrase panel */}
            {panelMode === 'paraphrase' && (
                <div
                    className="llm-panel"
                    style={{
                        top: panelRect.top,
                        left: panelRect.left,
                        width: panelRect.width,
                    }}
                >
                    <div className="llm-paraphrase-card">
                        <div
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                marginBottom: 8,
                            }}
                        >
                            <div style={{ fontSize: 13, color: 'var(--wf-muted, #9fb0c6)' }}>
                                {kindTitleMap[kind]}
                            </div>
                            <div style={{ display: 'flex', gap: 8 }}>
                                <button
                                    className="llm-btn"
                                    onClick={() => copyToClipboard(result)}
                                >
                                    Copy
                                </button>
                                <button
                                    className="llm-btn"
                                    onClick={() => setEditMode(s => !s)}
                                >
                                    {editMode ? 'Done' : 'Edit'}
                                </button>
                                {kind !== 'title' && kind !== 'abstract' && kind !== 'keywords' && (
                                    <button
                                        className="llm-btn"
                                        onClick={() => setShowDiff(s => !s)}
                                    >
                                        {showDiff ? 'Hide' : 'Track'}
                                    </button>
                                )}
                            </div>
                        </div>

                        {loading ? (
                            <div
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    padding: 24,
                                }}
                            >
                                <Spinner />
                                <div style={{ marginLeft: 10, color: 'var(--wf-muted, #9aa4b2)' }}>
                                    Waiting for AI...
                                </div>
                            </div>
                        ) : (
                            <>
                                {editMode ? (
                                    <textarea
                                        ref={editRef}
                                        value={result}
                                        onChange={e => setResult(e.target.value)}
                                        style={{
                                            width: '100%',
                                            minHeight: 88,
                                            maxHeight: contentMaxHeight,
                                            overflowY: 'auto',
                                            overflowX: 'hidden',
                                            padding: 10,
                                            borderRadius: 8,
                                            background: 'rgba(255,255,255,0.02)',
                                            color: '#e6eef8',
                                            outline: 'none',
                                            resize: 'vertical',
                                            boxSizing: 'border-box',
                                            border: 'none',
                                        }}
                                    />
                                ) : (
                                    <div style={{ minHeight: 88 }}>
                                        <div
                                            style={{
                                                maxHeight: contentMaxHeight,
                                                overflowY: 'auto',
                                                overflowX: 'hidden',
                                                paddingRight: 8,
                                            }}
                                        >
                                            <div
                                                className="llm-result-html"
                                                style={{ color: '#e6eef8' }}
                                                dangerouslySetInnerHTML={{ __html: renderedHtml }}
                                            />
                                        </div>
                                    </div>
                                )}

                                <div className="llm-paraphrase-footer">
                                    <button
                                        className="llm-btn llm-primary"
                                        onClick={() => {
                                            setPanelMode('hidden')
                                            setAnchorShown(false)
                                            setResult('')
                                            setQuery('')
                                        }}
                                    >
                                        Cancel
                                    </button>

                                    {kind === 'title' || kind === 'abstract' || kind === 'keywords' ? (
                                        <button
                                            className="llm-btn llm-primary"
                                            onClick={() => insertCodeAfterSelection(result)}
                                            disabled={loading || !result}
                                        >
                                            Insert
                                        </button>
                                    ) : kind === 'summarize' || kind === 'explain' ? null : (
                                        <button
                                            className="llm-btn llm-primary"
                                            onClick={() => replaceSelectionWith(result)}
                                            disabled={loading || !result}
                                        >
                                            Replace
                                        </button>
                                    )}

                                    <button
                                        className="llm-btn llm-primary"
                                        onClick={() =>
                                            kind === 'title' ||
                                            kind === 'abstract' ||
                                            kind === 'keywords'
                                                ? startGenerate(
                                                      kind as 'title' | 'abstract' | 'keywords'
                                                  )
                                                : startFetch(kindToMode[kind], kind)
                                        }
                                        disabled={loading}
                                    >
                                        Regenerate
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}
        </div>
    )
})

LLMToolbar.displayName = 'LLMToolbar'
export default LLMToolbar
