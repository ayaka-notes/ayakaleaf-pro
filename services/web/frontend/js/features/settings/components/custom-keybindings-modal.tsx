import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  OLModal,
  OLModalBody,
  OLModalFooter,
  OLModalHeader,
  OLModalTitle,
} from '@/shared/components/ol/ol-modal'
import OLButton from '@/shared/components/ol/ol-button'
import OLButtonGroup from '@/shared/components/ol/ol-button-group'
import { useUserSettingsContext } from '@/shared/context/user-settings-context'
import { saveUserSettings } from '@/features/ide-settings/utils/api'
import {
  KEYBINDING_ACTIONS,
  isValidKeyString,
  keyStringFromKeyboardEvent,
} from '@/shared/keybinding-actions'
import type { Keybindings } from '../../../../../types/user-settings'

/**
 * 2026-09-09 (owner R9 #4): custom key bindings manager (mysettings).
 *
 * One table of the available keybindings: the stock Overleaf default, the
 * user's current binding, and a rebind control ("press keys…").
 *
 * Import JSON / Export JSON persist the set as
 * { mode, customKeybindings: { commandId: keyString } }.
 * Reset-to-default picks the base preset (Overleaf / Vim / Emacs) and
 * clears the custom bindings. Cancel discards; Apply persists both the
 * mode (if changed) and the customKeybindings map (user-wide — the editor
 * applies them in every mode via the window-capture listener).
 */
type CustomMap = Record<string, string>

export default function CustomKeybindingsModal({
  show,
  onClose,
}: {
  show: boolean
  onClose: () => void
}) {
  const { t } = useTranslation()
  const { userSettings, setUserSettings } = useUserSettingsContext()

  const currentMode: Keybindings =
    (userSettings?.mode as Keybindings) || 'default'
  const storedCustom = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(userSettings?.customKeybindings || {}).filter(
          ([, v]) => typeof v === 'string' && v.length > 0
        )
      ),
    [userSettings]
  )

  const [draft, setDraft] = useState<CustomMap>({})
  const [modeDraft, setModeDraft] = useState<Keybindings>('default')
  const [capturing, setCapturing] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  // 2026-09-09 (owner live feedback): "Reset now" must NOT just close the
  // modal — it reports what was applied and stays open for confirmation.
  const [resetApplied, setResetApplied] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // (re)initialize on each open
  useEffect(() => {
    if (show) {
      setDraft({ ...storedCustom })
      // 'custom' is a valid account mode (default keymap + own bindings);
      // the modal preset row itself only offers the real presets.
      setModeDraft(currentMode === 'custom' ? 'default' : currentMode)
      setCapturing(null)
      setSaved(false)
      setResetApplied(false)
    }
    // Only re-init on open/close — draft edits must not clobber the user's
    // in-flight changes, even though storedCustom/currentMode are sources.
    // biome-ignore lint/correctness/useExhaustiveDependencies: intentional init-on-open
  }, [show])

  // key capture: while a row is capturing, the NEXT keydown sets its binding.
  // 2026-09-09 (live R9): one-shot closure listener attached at click time —
  // the action id is captured directly (no ref/state closure dance), which
  // the effect/ref variant got wrong under React's minified build.
  const startCapturing = (id: string) => {
    setCapturing(id)
    // 2026-09-09 (live): the FIRST keydown of a chord is the modifier
    // (e.g. 'Control') — those must be ignored; only the primary key
    // (non-modifier) completes the capture. A handler that reacts to the
    // modifier consumes the chord and never sees the real key.
    const MODS = new Set([
      'Control', 'Shift', 'Alt', 'Meta', 'OS', 'Process', 'AltGraph',
    ])
    const handler = (event: KeyboardEvent) => {
      if (MODS.has(event.key)) return
      window.removeEventListener('keydown', handler, true)
      event.preventDefault()
      event.stopPropagation()
      if (event.key === 'Escape') {
        setCapturing(null)
        return
      }
      const ks = keyStringFromKeyboardEvent(event)
      if (ks) {
        setDraft(d => ({ ...d, [id]: ks }))
      }
      setCapturing(null)
    }
    window.addEventListener('keydown', handler, true)
  }

  const changed =
    JSON.stringify(sortObject(draft)) !== JSON.stringify(sortObject(storedCustom)) ||
    (modeDraft === 'custom' ? 'default' : modeDraft) !== (currentMode === 'custom' ? 'default' : currentMode)

  function sortObject(obj: Record<string, string>) {
    return Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b)))
  }

  const doExport = () => {
    const payload = {
      version: 1,
      mode: modeDraft,
      customKeybindings: sortObject(draft),
    }
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'overleaf-keybindings.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  const doImportFile = async (file: File) => {
    try {
      const text = await file.text()
      const json = JSON.parse(text)
      const src: Record<string, unknown> =
        json && typeof json === 'object'
          ? typeof json.customKeybindings === 'object' && json.customKeybindings !== null
            ? (json.customKeybindings as Record<string, unknown>)
            : typeof json.custom === 'object' && json.custom !== null
              ? (json.custom as Record<string, unknown>)
              : json
          : {}
      const known = new Set(KEYBINDING_ACTIONS.map(a => a.id))
      // JSON-import safety (owner R10 #1): accept ONLY known action ids with
      // a syntactically valid key string. Values are never executed — they
      // can only trigger one of the fixed command-registry handlers.
      const next: CustomMap = {}
      let invalid = 0
      for (const [k, v] of Object.entries(src || {})) {
        if (!known.has(k) || !isValidKeyString(v)) {
          invalid += 1
          continue
        }
        next[k] = v as string
      }
      setDraft(prev => ({ ...prev, ...next }))
      if (
        json &&
        typeof json === 'object' &&
        ['default', 'vim', 'emacs', 'custom'].includes(json.mode)
      ) {
        setModeDraft(json.mode as Keybindings)
      }
      // eslint-disable-next-line no-console
      console.info(
        `custom keybindings import: ${Object.keys(next).length} bound, ${invalid} skipped (unknown key or not a string)`
      )
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('custom keybindings import failed', err)
    }
  }

  const doApply = async () => {
    try {
      const preset = modeDraft === 'custom' ? 'default' : modeDraft
      if (preset !== (currentMode === 'custom' ? 'default' : currentMode)) {
        await saveUserSettings('mode', preset)
        setUserSettings({ ...userSettings, mode: preset })
      }
      if (JSON.stringify(sortObject(draft)) !== JSON.stringify(sortObject(storedCustom))) {
        const payload: Record<string, string | null> = {}
        for (const a of KEYBINDING_ACTIONS) {
          payload[a.id] = draft[a.id] || null
        }
        await saveUserSettings('customKeybindings', payload)
        setUserSettings({ ...userSettings, customKeybindings: { ...draft } })
      }
      setSaved(true)
      window.setTimeout(onClose, 600)
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('saving custom key bindings failed', err)
    }
  }

  // 2026-09-09 (owner live feedback, supersedes R11 #3): "Reset now"
  // pre-fill/apply the SELECTED preset (Overleaf / Vim / Emacs) as the
  // account-wide keybinding default, clears custom overrides, PERSISTS,
  // and reports the applied preset IN the modal — it no longer just
  // closes. (The live editor keymaps are a per-project setting; the
  // account default takes effect on the next project load.)
  const doResetNow = async () => {
    try {
      const preset = modeDraft === 'custom' ? 'default' : modeDraft
      await saveUserSettings('mode', preset)
      const payload: Record<string, string | null> = {}
      for (const a of KEYBINDING_ACTIONS) {
        payload[a.id] = null
      }
      await saveUserSettings('customKeybindings', payload)
      setUserSettings({ ...userSettings, mode: preset, customKeybindings: {} })
      setModeDraft(preset)
      setDraft({})
      setResetApplied(true)
      setSaved(false)
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('reset to preset failed', err)
    }
  }

  return (
    <OLModal show={show} onHide={onClose} data-testid="custom-keybindings-modal">
      <OLModalHeader>
        <OLModalTitle>{t('kb_customize_title', 'Customize key bindings')}</OLModalTitle>
      </OLModalHeader>
      <OLModalBody>
        <p className="form-text mb-3">
          {t(
            'kb_customize_desc',
            'Rebind any action to your own keys. The defaults are the Overleaf bindings; "Current" is yours (empty = stock default). Custom bindings apply in the editor on top of whichever keymap you use (Overleaf / Vim / Emacs).'
          )}
        </p>
        <div className="table-responsive">
          <table className="table table-sm align-middle kb-custom-table">
            <thead>
              <tr>
                <th scope="col">{t('kb_col_action', 'Action')}</th>
                <th scope="col">{t('kb_col_default', 'Default')}</th>
                <th scope="col">{t('kb_col_current', 'Current')}</th>
                <th scope="col" className="text-end">
                  {t('kb_col_change', 'Change')}
                </th>
              </tr>
            </thead>
            <tbody>
              {KEYBINDING_ACTIONS.map(action => {
                const value = draft[action.id] || ''
                const isCapturing = capturing === action.id
                return (
                  <tr key={action.id}>
                    <td>{t(action.key, action.label)}</td>
                    <td>
                      <kbd className="kb-kbd">{action.defaultKey}</kbd>
                    </td>
                    <td>
                      {value ? (
                        <kbd className="kb-kbd kb-kbd-custom">{value}</kbd>
                      ) : (
                        <span className="text-muted">— {t('kb_uses_default', 'default')}</span>
                      )}
                    </td>
                    <td className="text-end">
                      {isCapturing ? (
                        <span className="kb-capturing">
                          {t('kb_press_keys', 'Press keys…')} (Esc {t('kb_cancel', 'cancel')})
                        </span>
                      ) : (
                        <OLButton
                          variant="secondary"
                          size="sm"
                          onClick={() => startCapturing(action.id)}
                        >
                          {t('kb_rebind', 'Rebind')}
                        </OLButton>
                      )}{' '}
                      {value ? (
                        <OLButton
                          variant="link"
                          size="sm"
                          onClick={() => setDraft(d => ({ ...d, [action.id]: '' }))}
                        >
                          {t('kb_clear', 'Clear')}
                        </OLButton>
                      ) : null}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div className="my-3">
          <strong>{t('kb_reset_default', 'Reset to default')}</strong>
          <div className="form-check form-check-inline">
            <input
              className="form-check-input"
              type="radio"
              id="kb-preset-overleaf"
              name="kb-preset"
              checked={modeDraft === 'default'}
              onChange={() => setModeDraft('default')}
            />
            <label className="form-check-label" htmlFor="kb-preset-overleaf">
              {t('kb_preset_overleaf', 'Overleaf (default)')}
            </label>
          </div>
          <div className="form-check form-check-inline">
            <input
              className="form-check-input"
              type="radio"
              id="kb-preset-vim"
              name="kb-preset"
              checked={modeDraft === 'vim'}
              onChange={() => setModeDraft('vim')}
            />
            <label className="form-check-label" htmlFor="kb-preset-vim">
              {t('kb_preset_vim', 'Vim')}
            </label>
          </div>
          <div className="form-check form-check-inline">
            <input
              className="form-check-input"
              type="radio"
              id="kb-preset-emacs"
              name="kb-preset"
              checked={modeDraft === 'emacs'}
              onChange={() => setModeDraft('emacs')}
            />
            <label className="form-check-label" htmlFor="kb-preset-emacs">
              {t('kb_preset_emacs', 'Emacs')}
            </label>
          </div>{' '}
          <OLButton
            variant="secondary"
            size="sm"
            onClick={() => void doResetNow()}
          >
            {t('kb_reset_apply', 'Reset now')}
          </OLButton>
          {resetApplied ? (
            <span className="form-text ms-2 d-inline-block">
              ✓{' '}
              {t(
                'kb_reset_applied',
                'Applied as your account default — the editor uses it on the next project load.'
              )}
            </span>
          ) : null}
        </div>

        <div className="d-flex flex-wrap align-items-center gap-2">
          <OLButton
            variant="secondary"
            size="sm"
            onClick={() => fileRef.current && fileRef.current.click()}
          >
            {t('kb_import_json', 'Import JSON')}
          </OLButton>
          <OLButton variant="secondary" size="sm" onClick={doExport}>
            {t('kb_export_json', 'Export JSON')}
          </OLButton>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            onChange={e => {
              const f = e.target.files && e.target.files[0]
              if (f) void doImportFile(f)
              e.target.value = ''
            }}
          />
          <span className="form-text ms-auto mb-0">
            {saved
              ? t('kb_saved', 'Saved')
              : t(
                  'kb_scope_note',
                  'Saved account-wide; the editor applies it on the next project load (or right away for the active editor).'
                )}
          </span>
        </div>
      </OLModalBody>
      <OLModalFooter>
        <OLButtonGroup>
          <OLButton variant="secondary" onClick={onClose}>
            {t('cancel', 'Cancel')}
          </OLButton>
          <OLButton
            variant="primary"
            disabled={!changed && !saved}
            onClick={() => void doApply()}
          >
            {t('apply', 'Apply')}
          </OLButton>
        </OLButtonGroup>
      </OLModalFooter>
    </OLModal>
  )
}
