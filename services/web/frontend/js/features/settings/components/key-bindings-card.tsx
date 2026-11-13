import { useTranslation } from 'react-i18next'
import { useState } from 'react'
import {
  UserSettingsProvider,
  useUserSettingsContext,
} from '@/shared/context/user-settings-context'
import { saveUserSettings } from '@/features/ide-settings/utils/api'
import CustomKeybindingsModal from './custom-keybindings-modal'
import OLButton from '@/shared/components/ol/ol-button'
import { UserSettings } from '../../../../../types/user-settings'

const OPTIONS: {
  value: UserSettings['mode']
  label: string
  desc: string
}[] = [
  {
    value: 'default',
    label: 'Default (Overleaf)',
    desc: 'The current standard editor keybindings (Ctrl/Cmd + …).',
  },
  {
    value: 'vim',
    label: 'Vim',
    desc: 'Vim emulation mode (i, Esc, h/j/k/l, dw, gg, G, / …).',
  },
  {
    value: 'emacs',
    label: 'Emacs',
    desc: 'Emacs emulation mode (C-a, C-e, C-f/C-b, C-k, C-w, M-f …).',
  },
  // 2026-09-09 (owner R11 #2): Custom = Overleaf defaults + your own bindings.
  {
    value: 'custom',
    label: 'Custom',
    desc: 'The Overleaf keymap with your own custom bindings added on top (Customize key bindings).',
  },
]

function KeyBindingsInner() {
  const { userSettings, setUserSettings } = useUserSettingsContext()
  const { t } = useTranslation()
  const mode = userSettings.mode || 'default'
  const [showCustomModal, setShowCustomModal] = useState(false)

  const change = (value: UserSettings['mode']) => {
    setUserSettings({ ...userSettings, mode: value })
    saveUserSettings('mode', value)
  }

  return (
    <div className="kb-card">
      {/* 2026-09-09 (owner #12): section carries its OWN heading — the
          duplicated card-header <strong> was removed from mysettings. */}
      <h3 id="keybindings-heading" style={{ marginTop: 0 }}>{t('keybindings')}</h3>
      <p className="form-text mb-3">{t('keybindings_help')}</p>
      {OPTIONS.map(option => (
        <div className="form-check mb-2" key={option.value}>
          <input
            className="form-check-input"
            type="radio"
            id={`kb-mode-${option.value}`}
            name="kb-mode"
            value={option.value}
            checked={mode === option.value}
            onChange={() => change(option.value)}
          />
          <label
            className="form-check-label ms-2"
            htmlFor={`kb-mode-${option.value}`}
          >
            <strong>{option.label}</strong>{' '}
            <span className="form-text d-block ms-0">
              {t(`keybindings_${option.value}_desc`, option.desc)}
            </span>
          </label>
        </div>
      ))}
      <p className="form-text mt-3 mb-0">{t('keybindings_applied_note')}<br />{t('keybindings_sublime_note')}</p>
      {/* 2026-09-09 (owner R9 #4): custom key bindings manager — table of all
          available bindings with default + current values, per-action
          rebinding, JSON import/export, reset to Overleaf/Vim/Emacs defaults,
          Cancel/Apply. */}
      <div className="mt-3 pt-3" style={{ borderTop: '1px solid rgba(27,34,44,0.12)' }}>
        <OLButton
          variant="secondary"
          size="sm"
          onClick={() => setShowCustomModal(s => !s)}
        >
          {t('kb_customize_title', 'Customize key bindings…')}
        </OLButton>
        <span className="form-text ms-2 d-inline-block">
          {t(
            'kb_customize_card_hint',
            'Rebind individual actions to your own keys (import / export as JSON).'
          )}
        </span>
      </div>
      {showCustomModal ? (
        <CustomKeybindingsModal show onClose={() => setShowCustomModal(false)} />
      ) : null}
    </div>
  )
}

/**
 * Per-user key bindings (owner request 2026-09-06, live-07 #5): wraps the
 * shared user-settings context (the /user/mysettings page already embeds the
 * `ol-userSettings` meta, and the project list page uses the same pattern),
 * and persists the choice through the standard `saveUserSettings('mode', …)`
 * endpoint. The source editor applies `userSettings.mode` via
 * `setKeybindings()` (use-codemirror-scope.ts) — the same store the project
 * settings "Key bindings" dropdown writes to, so both stay in sync.
 */
export default function KeyBindingsCard() {
  return (
    <UserSettingsProvider>
      <KeyBindingsInner />
    </UserSettingsProvider>
  )
}
