import { renderInReactLayout } from '@/react'
import '@/utils/meta'
import '@/utils/webpack-public-path'
import '@/infrastructure/error-reporter'
import '@/i18n'
import { useTranslation } from 'react-i18next'
import { SplitTestProvider } from '@/shared/context/split-test-context'
import { SymbolPaletteConfigProvider } from '../../../../modules/symbol-palette/frontend/js/context/symbol-palette-context'
import SymbolPaletteSettings from '../../../../modules/symbol-palette/frontend/js/components/symbol-palette-settings'

function SymbolPaletteSettingsPage() {
  const { t } = useTranslation()
  return (
    <div className="sp-page">
      <h1 className="sp-page-title">{t('symbol_palette')}</h1>
      <SymbolPaletteConfigProvider>
        <SymbolPaletteSettings />
      </SymbolPaletteConfigProvider>
    </div>
  )
}

renderInReactLayout('symbol-palette-page-root', () => (
  <SplitTestProvider>
    <SymbolPaletteSettingsPage />
  </SplitTestProvider>
))
