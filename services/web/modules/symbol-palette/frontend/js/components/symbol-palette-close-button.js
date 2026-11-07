import { useEditorPropertiesContext } from '@/features/ide-react/context/editor-properties-context'
import { useActiveOverallTheme } from '@/shared/hooks/use-active-overall-theme'
import { useTranslation } from 'react-i18next'
import PropTypes from 'prop-types'

export default function SymbolPaletteCloseButton() {
  const { toggleSymbolPalette } = useEditorPropertiesContext()
  const { t } = useTranslation()
  const overallTheme = useActiveOverallTheme()

  const handleClick = () => {
    toggleSymbolPalette()
    window.dispatchEvent(new CustomEvent('editor:focus'))
  }

  return (
    <div className="symbol-palette-close-button-outer">
      <button
        type="button"
        className="btn-close symbol-palette-close-button"
        style={
          overallTheme === 'dark'
            ? { filter: 'invert(1) grayscale(100%) brightness(200%)' }
            : undefined
        }
        onClick={handleClick}
        aria-label={t('close')}
      >
      </button>
    </div>
  )
}

SymbolPaletteCloseButton.propTypes = {
  focusInput: PropTypes.func,
}
