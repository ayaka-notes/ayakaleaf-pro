/**
 * 2026-09-09 (owner R9 #4): custom key bindings.
 *
 * The rebindable action set for the editor. Two tiers:
 *  1. **registry tier** — every id below is also a command-registry
 *     command id (see frontend/js/features/ide-react/context/command-
 *     registry-context.tsx); a custom binding invokes that registered
 *     handler (cut/copy/compile/downloads/layouts/…).
 *  2. **editor tier** — actions bound inside the source editor's own
 *     CodeMirror keymap (delete line, indent, case, fold, line moves,
 *     find-next, …). A custom binding replays the action's stock key combo
 *     as a real keydown on the active editor view, so it resolves against
 *     WHICHEVER keymap mode is active (Default / Vim / Emacs / Custom).
 *
 * `defaultKey` is the stock Overleaf binding for that action; it is what
 * the manager shows in the "Default" column. Keys use the CodeMirror 6 key
 * syntax (Mod- / Shift- / Alt-), so they are both human-readable and
 * directly dispatchable.
 */
import { EditorView } from '@codemirror/view'

export interface KeybindingAction {
  id: string
  label: string
  // i18n key for the label (falls back to the literal label)
  key: string
  defaultKey: string
  // editor tier: the stock CM keymap combo to replay when this action is
  // bound to a user key (candidates tried in order until one is handled).
  dispatchKeys?: string[]
}

export const KEYBINDING_ACTIONS: KeybindingAction[] = [
  { id: 'cut', label: 'Cut', key: 'kb_cut', defaultKey: 'Mod-x' },
  { id: 'copy', label: 'Copy', key: 'kb_copy', defaultKey: 'Mod-c' },
  { id: 'paste', label: 'Paste', key: 'kb_paste', defaultKey: 'Mod-v' },
  {
    id: 'paste-special',
    label: 'Paste special',
    key: 'kb_paste_special',
    defaultKey: 'Mod-Shift-V',
  },
  { id: 'undo', label: 'Undo', key: 'kb_undo', defaultKey: 'Mod-z' },
  { id: 'redo', label: 'Redo', key: 'kb_redo', defaultKey: 'Mod-y' },
  { id: 'find', label: 'Find', key: 'kb_find', defaultKey: 'Mod-f' },
  {
    id: 'select-all',
    label: 'Select all',
    key: 'kb_select_all',
    defaultKey: 'Mod-a',
  },
  {
    id: 'insert-comment',
    label: 'Insert comment',
    key: 'kb_insert_comment',
    defaultKey: 'Mod-Shift-C',
  },
  {
    id: 'format-bold',
    label: 'Format: bold',
    key: 'kb_format_bold',
    defaultKey: 'Mod-b',
  },
  {
    id: 'format-italics',
    label: 'Format: italics',
    key: 'kb_format_italics',
    defaultKey: 'Mod-i',
  },
  {
    id: 'toggle-track-changes',
    label: 'Toggle track changes',
    key: 'kb_toggle_track_changes',
    defaultKey: 'Mod-Shift-A',
  },
  {
    id: 'command-palette',
    label: 'Command palette',
    key: 'kb_command_palette',
    defaultKey: 'Mod-p',
  },
  // 2026-09-09 (owner R10 #1: "there are MORE key bindings") — the full
  // command-registry catalog (compile, downloads, layouts, inserts, lists,
  // PDF controls, synctex). defaultKey '∅' = no stock binding.
  { id: 'compile', label: 'Compile (run)', key: 'kb_compile', defaultKey: '∅' },
  { id: 'stop-compile', label: 'Stop compile', key: 'kb_stop_compile', defaultKey: '∅' },
  {
    id: 'recompile-from-scratch',
    label: 'Recompile from scratch',
    key: 'kb_recompile_scratch',
    defaultKey: '∅',
  },
  {
    id: 'open-settings',
    label: 'Open editor settings',
    key: 'kb_open_settings',
    defaultKey: '∅',
  },
  { id: 'insert-symbol', label: 'Insert symbol', key: 'kb_insert_symbol', defaultKey: '∅' },
  {
    id: 'insert-display-math',
    label: 'Insert display math',
    key: 'kb_insert_display_math',
    defaultKey: '∅',
  },
  {
    id: 'insert-inline-math',
    label: 'Insert inline math',
    key: 'kb_insert_inline_math',
    defaultKey: '∅',
  },
  { id: 'insert-citation', label: 'Insert citation', key: 'kb_insert_citation', defaultKey: '∅' },
  {
    id: 'insert-cross-reference',
    label: 'Insert cross-reference',
    key: 'kb_insert_crossref',
    defaultKey: '∅',
  },
  { id: 'insert-link', label: 'Insert link', key: 'kb_insert_link', defaultKey: '∅' },
  { id: 'insert-table', label: 'Insert table', key: 'kb_insert_table', defaultKey: '∅' },
  {
    id: 'format-bullet-list',
    label: 'Format: bullet list',
    key: 'kb_format_bullet_list',
    defaultKey: '∅',
  },
  {
    id: 'format-numbered-list',
    label: 'Format: numbered list',
    key: 'kb_format_numbered_list',
    defaultKey: '∅',
  },
  { id: 'comment', label: 'Comment / uncomment line', key: 'kb_comment_line', defaultKey: '∅' },
  { id: 'close-tab', label: 'Close source tab', key: 'kb_close_tab', defaultKey: '∅' },
  {
    id: 'close-other-tabs',
    label: 'Close other source tabs',
    key: 'kb_close_other_tabs',
    defaultKey: '∅',
  },
  { id: 'download-pdf', label: 'Download PDF', key: 'kb_download_pdf', defaultKey: '∅' },
  {
    id: 'download-as-source-zip',
    label: 'Download as source (zip)',
    key: 'kb_download_zip',
    defaultKey: '∅',
  },
  {
    id: 'change-layout-side-by-side',
    label: 'Layout: side by side',
    key: 'kb_layout_sbs',
    defaultKey: '∅',
  },
  {
    id: 'change-layout-editor-only',
    label: 'Layout: editor only',
    key: 'kb_layout_editor',
    defaultKey: '∅',
  },
  { id: 'change-layout-pdf-only', label: 'Layout: PDF only', key: 'kb_layout_pdf', defaultKey: '∅' },
  {
    id: 'change-layout-focus-mode',
    label: 'Layout: focus mode',
    key: 'kb_layout_focus',
    defaultKey: '∅',
  },
  {
    id: 'change-layout-detached-pdf',
    label: 'Layout: detached PDF',
    key: 'kb_layout_detached',
    defaultKey: '∅',
  },
  { id: 'view-pdf-zoom-in', label: 'PDF: zoom in', key: 'kb_pdf_zoom_in', defaultKey: '∅' },
  {
    id: 'view-pdf-zoom-out',
    label: 'PDF: zoom out',
    key: 'kb_pdf_zoom_out',
    defaultKey: '∅',
  },
  {
    id: 'view-pdf-presentation-mode',
    label: 'PDF: presentation mode',
    key: 'kb_pdf_present',
    defaultKey: '∅',
  },
  {
    id: 'view-pdf-fit-width',
    label: 'PDF: fit width',
    key: 'kb_pdf_fit_width',
    defaultKey: '∅',
  },
  {
    id: 'view-pdf-fit-height',
    label: 'PDF: fit height',
    key: 'kb_pdf_fit_height',
    defaultKey: '∅',
  },
  {
    id: 'synctex-sync-to-pdf',
    label: 'SyncTeX: position in PDF',
    key: 'kb_synctex_pdf',
    defaultKey: '∅',
  },
  {
    id: 'synctex-sync-to-code',
    label: 'SyncTeX: position in code',
    key: 'kb_synctex_code',
    defaultKey: '∅',
  },
  // 2026-09-09 (owner R11 #1: "existing overleaf keybinds" — the full stock
  // list): editor-tier actions bound in the CodeMirror keymap itself. A
  // custom binding replays the listed stock combo on the active editor
  // view (candidates tried until one handles the event).
  {
    id: 'save-compile',
    label: 'Save & compile',
    key: 'kb_save_compile',
    defaultKey: 'Mod-s',
    dispatchKeys: ['Mod-s'],
  },
  {
    id: 'toggle-comment',
    label: 'Toggle line comment',
    key: 'kb_toggle_comment',
    defaultKey: 'Mod-/',
    dispatchKeys: ['Mod-/'],
  },
  {
    id: 'delete-line',
    label: 'Delete line',
    key: 'kb_delete_line',
    defaultKey: 'Mod-d',
    dispatchKeys: ['Mod-d', 'Shift-Mod-k'],
  },
  {
    id: 'autocomplete',
    label: 'Autocomplete / reference search',
    key: 'kb_autocomplete',
    defaultKey: 'Mod-Space',
    dispatchKeys: ['Mod- '],
  },
  {
    id: 'fold-toggle',
    label: 'Fold / unfold here',
    key: 'kb_fold_toggle',
    defaultKey: 'F2',
    dispatchKeys: ['F2', 'Mod-Shift-['],
  },
  {
    id: 'fold-all',
    label: 'Fold all',
    key: 'kb_fold_all',
    defaultKey: 'Alt-Shift-1',
    dispatchKeys: ['Alt-Shift-1', 'Mod-Shift-['],
  },
  {
    id: 'unfold-all',
    label: 'Unfold all',
    key: 'kb_unfold_all',
    defaultKey: 'Alt-Shift-0',
    dispatchKeys: ['Alt-Shift-0', 'Mod-Shift-]'],
  },
  {
    id: 'indent-less',
    label: 'Indent less',
    key: 'kb_indent_less',
    defaultKey: 'Mod-[',
    dispatchKeys: ['Mod-['],
  },
  {
    id: 'indent-more',
    label: 'Indent more',
    key: 'kb_indent_more',
    defaultKey: 'Mod-]',
    dispatchKeys: ['Mod-]'],
  },
  {
    id: 'case-upper',
    label: 'Change selection to uppercase',
    key: 'kb_case_upper',
    defaultKey: 'Mod-u',
    dispatchKeys: ['Mod-u'],
  },
  {
    id: 'case-lower',
    label: 'Change selection to lowercase',
    key: 'kb_case_lower',
    defaultKey: 'Mod-Shift-u',
    dispatchKeys: ['Mod-Shift-u'],
  },
  {
    id: 'duplicate-line',
    label: 'Duplicate line',
    key: 'kb_duplicate_line',
    defaultKey: 'Mod-Shift-d',
    dispatchKeys: ['Mod-Shift-d'],
  },
  {
    id: 'copy-line-up',
    label: 'Copy line(s) up',
    key: 'kb_copy_line_up',
    defaultKey: 'Alt-Shift-ArrowUp',
    dispatchKeys: ['Alt-Shift-ArrowUp'],
  },
  {
    id: 'copy-line-down',
    label: 'Copy line(s) down',
    key: 'kb_copy_line_down',
    defaultKey: 'Alt-Shift-ArrowDown',
    dispatchKeys: ['Alt-Shift-ArrowDown'],
  },
  {
    id: 'move-line-up',
    label: 'Move line(s) up',
    key: 'kb_move_line_up',
    defaultKey: 'Alt-ArrowUp',
    dispatchKeys: ['Alt-ArrowUp'],
  },
  {
    id: 'move-line-down',
    label: 'Move line(s) down',
    key: 'kb_move_line_down',
    defaultKey: 'Alt-ArrowDown',
    dispatchKeys: ['Alt-ArrowDown'],
  },
  {
    id: 'line-start',
    label: 'Go to line start',
    key: 'kb_line_start',
    defaultKey: 'Alt-ArrowLeft',
    dispatchKeys: ['Alt-ArrowLeft', 'Ctrl-ArrowLeft', 'Home'],
  },
  {
    id: 'line-end',
    label: 'Go to line end',
    key: 'kb_line_end',
    defaultKey: 'Alt-ArrowRight',
    dispatchKeys: ['Alt-ArrowRight', 'Ctrl-ArrowRight', 'End'],
  },
  {
    id: 'doc-start',
    label: 'Go to document start',
    key: 'kb_doc_start',
    defaultKey: 'Mod-Home',
    dispatchKeys: ['Mod-Home'],
  },
  {
    id: 'doc-end',
    label: 'Go to document end',
    key: 'kb_doc_end',
    defaultKey: 'Mod-End',
    dispatchKeys: ['Mod-End'],
  },
  {
    id: 'goto-line',
    label: 'Go to line number…',
    key: 'kb_goto_line',
    defaultKey: 'Mod-Shift-l',
    dispatchKeys: ['Mod-Shift-l'],
  },
  {
    id: 'find-next',
    label: 'Find next',
    key: 'kb_find_next',
    defaultKey: 'Mod-g',
    dispatchKeys: ['Mod-g'],
  },
  {
    id: 'find-previous',
    label: 'Find previous',
    key: 'kb_find_previous',
    defaultKey: 'Mod-Shift-g',
    dispatchKeys: ['Mod-Shift-g'],
  },
  {
    id: 'add-cursor-up',
    label: 'Add cursor above',
    key: 'kb_add_cursor_up',
    defaultKey: 'Mod-Alt-ArrowUp',
    dispatchKeys: ['Mod-Alt-ArrowUp'],
  },
  {
    id: 'add-cursor-down',
    label: 'Add cursor below',
    key: 'kb_add_cursor_down',
    defaultKey: 'Mod-Alt-ArrowDown',
    dispatchKeys: ['Mod-Alt-ArrowDown'],
  },
  {
    id: 'review-panel',
    label: 'Toggle review panel',
    key: 'kb_review_panel',
    defaultKey: 'Mod-j',
    dispatchKeys: ['Mod-j'],
  },
]

/**
 * JSON-import / server-side value safety (owner R10 #1): a valid key string
 * is 1+ dash-separated parts, each either a modifier (Mod/Shift/Alt) or a
 * key name (single letter/number, F1-F12, or a known editor key name).
 * Nothing more exotic — so a stored binding can only match real keydowns.
 */
export function isValidKeyString(v: unknown): boolean {
  if (typeof v !== 'string' || !v || v.length > 32) return false
  const NAMED =
    /^(space|enter|backspace|delete|home|end|pageup|pagedown|esc|tab|arrowup|arrowdown|arrowleft|arrowright|f[1-9]|f1[0-2])$/i
  return v
    .split('-')
    .filter(p => p.length > 0)
    .every(p => /^(mod|shift|alt)$/i.test(p) || /^[a-z0-9]$/i.test(p) || NAMED.test(p))
}

/**
 * Normalize a stored/display key string for comparison: modifiers canonical
 * (Mod/Shift/Alt, order-independent), single characters lower-cased,
 * Ctrl/Control/Cmd/Meta all → mod. Returns '' for empty input.
 */
export function normalizeKeyBinding(str: string | null | undefined): string {
  if (!str) return ''
  const parts: string[] = []
  for (const raw of String(str).split('-')) {
    const p = raw.trim()
    if (!p) continue
    if (p.length === 1 && /[a-zA-Z]/.test(p)) parts.push(p.toLowerCase())
    else if (/^(mod|ctrl|control|cmd|meta)$/.test(p.toLowerCase())) parts.push('mod')
    else if (/^shift$/.test(p.toLowerCase())) parts.push('shift')
    else if (/^alt$/.test(p.toLowerCase())) parts.push('alt')
    else parts.push(p)
  }
  // canonical order: mod, shift, alt, key
  const order: Record<string, number> = { mod: 0, shift: 1, alt: 2 }
  parts.sort((a, b) => {
    const oa = order[a.toLowerCase()] ?? 3
    const ob = order[b.toLowerCase()] ?? 3
    return oa - ob || a.localeCompare(b)
  })
  return parts.join('-')
}

/**
 * Render a KeyboardEvent as the canonical key string ("mod-shift-k").
 * Returns '' for modifier-only presses and unbindable keys (F-keys are
 * allowed, dead keys are not).
 */
export function keyStringFromKeyboardEvent(e: KeyboardEvent): string {
  if (!e.key) return ''
  const KEY = e.key
  // ignore modifier-only presses + system keys
  if (
    ['Shift', 'Control', 'Alt', 'Meta', 'Process', 'CapsLock', 'OS', 'NumLock',
      'ScrollLock', 'Help', 'F20', 'F21', 'F22', 'F23', 'Unidentified',
      'Dead', 'AltGraph'].includes(KEY)
  ) {
    return ''
  }
  const parts: string[] = []
  if (e.metaKey || e.ctrlKey) parts.push('mod')
  if (e.shiftKey) parts.push('shift')
  if (e.altKey) parts.push('alt')
  let key = KEY
  if (key === ' ') key = 'Space'
  if (key === 'Backspace') key = 'Backspace'
  if (key.length === 1 && /[a-zA-Z]/.test(key)) key = key.toLowerCase()
  parts.push(key)
  return parts.join('-')
}

/* ------------------------------------------------------------------ */
/* Editor-tier dispatch (owner R11 #1)                                 */
/* ------------------------------------------------------------------ */

/**
 * Find the active CodeMirror editor view from the DOM (the project editor
 * renders exactly one `.cm-editor` when its tab is open).
 */
export function activeEditorView() {
  if (typeof document === 'undefined') return null
  const el = document.querySelector<HTMLElement>('.cm-editor')
  if (!el) return null
  try {
    // EditorView is the same bundled @codemirror/view module the editor
    // itself uses.
    return EditorView.findFromDOM(el)
  } catch {
    return null
  }
}

/**
 * Replay a CodeMirror key combo (e.g. 'Mod-Shift-u', 'Alt-ArrowUp', 'F2')
 * inside an editor view by dispatching the equivalent keydown. CM6's keymap
 * plugin listens for `keydown` on the editor DOM and matches the event's
 * key + modifier bits, so a synthetic event behaves like the real keypress
 * and resolves against WHICHEVER keymap stack is currently active
 * (default, vim, emacs, …).
 *
 * Returns true when some binding handled the event.
 */
export function replayEditorCombo(view: any, combo: string): boolean {
  if (!view || !combo) return false
  const parts = combo.split('-').filter(Boolean)
  if (parts.length < 1) return false
  const keyName = parts[parts.length - 1] ?? ''
  if (!keyName) return false
  const mods = new Set(parts.slice(0, -1).map(p => p.toLowerCase()))
  const isMac =
    typeof navigator !== 'undefined' &&
    /Mac|iPod|iPhone|iPad/.test(navigator.platform || '')
  const key = keyName === 'Space' ? ' ' : keyName
  const event = new KeyboardEvent('keydown', {
    key,
    ctrlKey: mods.has('ctrl') || (mods.has('mod') && !isMac),
    metaKey: mods.has('meta') || (mods.has('mod') && isMac),
    shiftKey: mods.has('shift'),
    altKey: mods.has('alt'),
    bubbles: true,
    cancelable: true,
  })
  const target: any = view.contentDOM || view.dom || null
  if (!target || typeof target.dispatchEvent !== 'function') return false
  try {
    target.dispatchEvent(event)
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('custom keybinding: replay failed', combo, err)
    return false
  }
  // keymap plugins call preventDefault when they handled the event
  return event.defaultPrevented
}

/**
 * Dispatch a bound action for the two tiers: registry command handlers
 * first (existing behaviour), then editor-tier keymap replay.
 */
export function runKeybindingAction(
  action: KeybindingAction,
  registry?: {
    get: (id: string) => { handler?: ((o?: unknown) => unknown) | null } | null
  }
): boolean {
  // Registry tier (R9/R10 actions: command-registry command ids).
  if (action.id && registry) {
    const command = registry.get(action.id)
    if (command && typeof command.handler === 'function') {
      try {
        command.handler({ location: 'custom-keybinding' })
        return true
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(`custom keybinding "${action.id}" failed`, err)
        return false
      }
    }
  }
  // Editor tier (R11 editor keymap actions).
  if (action.dispatchKeys && action.dispatchKeys.length > 0) {
    const view = activeEditorView()
    if (!view) return false
    for (const combo of action.dispatchKeys) {
      if (replayEditorCombo(view, combo)) return true
    }
    return false
  }
  return false
}
