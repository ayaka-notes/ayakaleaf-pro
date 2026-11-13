import React, { useEffect } from 'react'
import { useUserSettingsContext } from '@/shared/context/user-settings-context'
import { useCommandRegistry } from '@/features/ide-react/context/command-registry-context'
import {
  KEYBINDING_ACTIONS,
  keyStringFromKeyboardEvent,
  normalizeKeyBinding,
  runKeybindingAction,
} from '@/shared/keybinding-actions'

/**
 * 2026-09-09 (owner R9 #4 + R11 #1): activates custom key bindings inside
 * the project editor.
 *
 * Each custom binding is `action id → key string` (CodeMirror 6 syntax),
 * stored per user (user.ace.customKeybindings, exposed as
 * ol-userSettings.customKeybindings). A capture-phase window keydown
 * listener matches the pressed key against the user's map (normalized,
 * order-insensitive) and triggers the matching action:
 *
 *   • registry tier — the action's command-registry handler (cut/copy,
 *     compile, inserts, PDF controls, …);
 *   • editor tier — replays the action's stock CodeMirror key binding on
 *     the active editor view, so it works against WHICHEVER keymap mode is
 *     active (default, Vim and Emacs emulation all included).
 *
 * Capture phase + preventDefault means the user's binding wins over the
 * stock keymaps.
 */
export default function CustomKeybindingsActivator() {
  const { userSettings } = useUserSettingsContext()
  const { registry } = useCommandRegistry()

  const bindings = userSettings?.customKeybindings || {}

  useEffect(() => {
    const active = Object.entries(bindings).filter(
      ([, k]) => typeof k === 'string' && k.length > 0
    )
    if (active.length === 0) return undefined

    const actionsById = new Map(KEYBINDING_ACTIONS.map(a => [a.id, a]))
    const byKey = new Map<string, (typeof KEYBINDING_ACTIONS)[number]>()
    for (const [id, k] of active) {
      const action = actionsById.get(id)
      if (!action) continue
      const norm = normalizeKeyBinding(k)
      if (norm && !byKey.has(norm)) byKey.set(norm, action)
    }
    if (byKey.size === 0) return undefined

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return
      const target = e.target as HTMLElement | null
      // never hijack keys while typing in a real form control OUTSIDE the
      // source editor (search boxes, chat input, settings inputs …)
      if (
        target &&
        /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) &&
        !target.closest('.cm-editor')
      ) {
        return
      }
      const pressed = keyStringFromKeyboardEvent(e)
      if (!pressed) return
      const action = byKey.get(pressed)
      if (!action) return
      // The user bound this key — consume it even when the action cannot
      // run here (e.g. no editor open), so it doesn't fall through to a
      // stock binding or a typed character.
      e.preventDefault()
      e.stopPropagation()
      void runKeybindingAction(action, registry)
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [bindings, registry])

  // Headless: installs/removes the listener only.
  return null
}
