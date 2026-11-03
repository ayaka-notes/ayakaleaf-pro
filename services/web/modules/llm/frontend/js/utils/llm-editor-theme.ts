// overleaf-lab: owner request (2026-08-25) — the CHAT AI window (and other
// AI surfaces in the IDE) must follow the EDITOR theme ("The code editor
// color scheme", IDE → Appearance → Editor theme), not a fixed palette.
//
// Mechanism (no timers, event-driven only):
//   1. On demand + on theme/overall-theme changes, read the Live editor's
//      computed background/foreground (CodeMirror root or its scroller).
//   2. Write --wf-editor-bg / --wf-editor-fg on the scoped element
//      (.llm-wf-editor-scoped — rail panel, selection toolbar overlay).
//   3. llm-ui.scss maps the whole token layer onto those two values via
//      color-mix, so bubbles/borders/code surfaces derive from the editor
//      theme automatically.
//
// Fallback: if no editor node exists yet (lazy load) or it is transparent,
// the variables are simply not set and the fixed upstream palette applies.
export function readEditorThemeColors(): { bg?: string; fg?: string } {
    const editor = document.querySelector<HTMLElement>('.cm-editor')
    if (!editor) return {}
    const cs = getComputedStyle(editor)
    let bg = cs.backgroundColor
    let fg = cs.color
    if (!bg || bg === 'transparent' || bg === 'rgba(0, 0, 0, 0)') {
        const scroller = editor.querySelector<HTMLElement>('.cm-scroller')
        if (scroller) {
            const scs = getComputedStyle(scroller)
            bg = bg || scs.backgroundColor
            fg = fg || scs.color
        }
    }
    const out: { bg?: string; fg?: string } = {}
    if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') out.bg = bg
    if (fg) out.fg = fg
    return out
}

export function applyEditorThemeVars(scope: HTMLElement | null): void {
    if (!scope) return
    let { bg, fg } = readEditorThemeColors()
    // overleaf-lab (2026-11): a user's editor theme can supply a background /
    // foreground pair with poor or zero contrast (e.g. a dark background with a
    // dark root text color). The panel then becomes unreadable — exactly the
    // "conflicting background and font colors" report. Guard: if the pair does
    // not reach WCAG AA (4.5:1), pin the text to a color that does.
    if (bg && fg) {
        const c = parseColor(bg)
        const f = parseColor(fg)
        if (c && f && contrastRatio(c, f) < 4.5) {
            const bgLum = luminance(c)
            fg = bgLum < 0.4 ? '#f4f5f6' : '#111418'
            scope.style.setProperty('--wf-editor-fg', fg)
            bg = bg // keep the real background
        }
    }
    if (bg) scope.style.setProperty('--wf-editor-bg', bg)
    if (fg) scope.style.setProperty('--wf-editor-fg', fg)
    // Keep the accent legible on DARK editor themes (e.g. dracula/monokai
    // chosen while the overall UI stays light): navy on near-black is
    // unreadable, so switch to the light blue accent automatically.
    if (bg) {
        const m = bg.match(/rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/)
        if (m) {
            const lum = (0.299 * Number(m[1]) + 0.587 * Number(m[2]) + 0.114 * Number(m[3])) / 255
            if (lum < 0.5) {
                scope.style.setProperty('--wf-accent', '#6597e0')
                scope.style.setProperty('--wf-accent-hi', '#7dabec')
                scope.style.setProperty('--wf-accent-soft', 'rgba(101, 151, 224, 0.16)')
                return
            }
        }
    }
    scope.style.setProperty('--wf-accent', '#28518f')
    scope.style.setProperty('--wf-accent-hi', '#214475')
    scope.style.setProperty('--wf-accent-soft', 'rgba(40, 81, 143, 0.10)')
}

function parseColor(v: string): { r: number; g: number; b: number } | null {
    const m = v.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/)
    if (!m) return null
    return { r: +m[1], g: +m[2], b: +m[3] }
}

function luminance({ r, g, b }: { r: number; g: number; b: number }): number {
    const f = (v: number) => {
        const s = v / 255
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
    }
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

function contrastRatio(
    a: { r: number; g: number; b: number },
    b: { r: number; g: number; b: number }
): number {
    const l1 = luminance(a)
    const l2 = luminance(b)
    const hi = Math.max(l1, l2)
    const lo = Math.min(l1, l2)
    return (hi + 0.05) / (lo + 0.05)
}

export interface EditorThemeWatcher {
    stop: () => void
}

// Watches overall <html data-bs-theme> flips and the editor element's
// class/attribute/style changes (theme application), then re-reads colors.
export function watchEditorTheme(scopes: Array<HTMLElement | null>): EditorThemeWatcher {
    const update = () => {
        scopes.forEach(applyEditorThemeVars)
    }

    update()

    const docObs = new MutationObserver(() => {
        // Slight delay: theme CSS may apply after the attribute mutation.
        window.setTimeout(update, 0)
    })
    if (document.documentElement) {
        docObs.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['data-bs-theme', 'class'],
        })
    }

    let editorObs: MutationObserver | undefined
    let mountObs: MutationObserver | undefined
    const attachEditorObserver = () => {
        const editor = document.querySelector<HTMLElement>('.cm-editor')
        if (!editor) return false
        if (editorObs) editorObs.disconnect()
        editorObs = new MutationObserver(update)
        editorObs.observe(editor, {
            attributes: true,
            attributeFilter: ['class', 'style', 'data-theme', 'aria-theme'],
        })
        applyEditorThemeVars(editor) // the editor itself is a good scope
        return true
    }
    if (!attachEditorObserver()) {
        // Editor may mount late (IDE lazy-loads the file pane).
        mountObs = new MutationObserver(() => {
            if (attachEditorObserver() && mountObs) mountObs.disconnect()
        })
        mountObs.observe(document.body, { childList: true, subtree: true })
        // Safety: stop the mount observer if the editor never appears, so it
        // can never outlive the pane.
        window.setTimeout(() => mountObs?.disconnect(), 15000)
    }

    return {
        stop() {
            docObs.disconnect()
            editorObs?.disconnect()
            mountObs?.disconnect()
        },
    }
}
