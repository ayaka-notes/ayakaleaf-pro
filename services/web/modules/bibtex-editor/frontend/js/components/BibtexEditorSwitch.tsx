import { ChangeEvent, useCallback, useId } from 'react'
import { useTranslation } from 'react-i18next'
import { useEditorPropertiesContext } from '@/features/ide-react/context/editor-properties-context'
import OLTooltip from '@/shared/components/ol/ol-tooltip'

/**
 * A Code/Visual toggle for the BibTeX visual editor, modelled on the core
 * EditorSwitch (source-editor/components/editor-switch).
 *
 * The core EditorSwitch lives in the CodeMirror toolbar, portaled into a
 * CodeMirror panel. While a module visual editor (this one) is active, core
 * hides the whole CodeMirror view (`<div hidden>` => display:none), so that
 * toolbar — and the Code/Visual toggle with it — collapses to nothing. To keep
 * the switch available in Visual mode we render our own in the visual editor's
 * toolbar row.
 *
 * It reuses the same markup and CSS classes so it looks the same; the one
 * difference is a dedicated radio-group `name` (the hidden core switch still
 * uses `name="editor"`), which avoids the two toggles fighting over a single
 * native radio group.
 */
export default function BibtexEditorSwitch() {
  const { t } = useTranslation()
  const { showVisual: visual, setShowVisual: setVisual } =
    useEditorPropertiesContext()
  const codeId = useId()
  const visualId = useId()
  const groupName = useId()

  const handleChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setVisual(event.target.value === 'rich-text')
    },
    [setVisual]
  )

  return (
    <div
      className="editor-toggle-switch"
      aria-label={t('toolbar_code_visual_editor_switch')}
    >
      <form>
        <fieldset className="toggle-switch">
          <legend className="visually-hidden">Editor mode.</legend>

          <input
            type="radio"
            name={groupName}
            value="cm6"
            id={codeId}
            className="toggle-switch-input"
            checked={!visual}
            onChange={handleChange}
          />
          <label htmlFor={codeId} className="toggle-switch-label">
            <span>{t('code')}</span>
          </label>

          <OLTooltip
            id="bibtex-rich-text-toggle-tooltip"
            description={t('toolbar_change_editor_mode')}
            overlayProps={{ placement: 'bottom' }}
            tooltipProps={{ className: 'tooltip-wide' }}
          >
            <span>
              <input
                type="radio"
                name={groupName}
                value="rich-text"
                id={visualId}
                className="toggle-switch-input"
                checked={visual}
                onChange={handleChange}
              />
              <label htmlFor={visualId} className="toggle-switch-label">
                <span>{t('visual')}</span>
              </label>
            </span>
          </OLTooltip>
        </fieldset>
      </form>
    </div>
  )
}
