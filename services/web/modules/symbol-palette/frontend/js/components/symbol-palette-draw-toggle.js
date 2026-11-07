import { useTranslation } from 'react-i18next'
import PropTypes from 'prop-types'
import MaterialIcon from '@/shared/components/material-icon'
import OLTooltip from '@/shared/components/ol/ol-tooltip'

export default function SymbolPaletteDrawToggle({ active, setActive }) {
  const { t } = useTranslation()
  return (
    <OLTooltip
      id="symbol-palette-draw-toggle"
      description={t('symbol_palette_draw_a_symbol')}
      overlayProps={{ placement: 'top' }}
    >
      <button
        type="button"
        className="symbol-palette-draw-toggle"
        aria-label={t('symbol_palette_draw_a_symbol')}
        aria-pressed={active}
        onClick={() => setActive(!active)}
      >
        <MaterialIcon type="draw" />
      </button>
    </OLTooltip>
  )
}

SymbolPaletteDrawToggle.propTypes = {
  active: PropTypes.bool.isRequired,
  setActive: PropTypes.func.isRequired,
}
