import { useState } from 'react'
import RailPanelHeader from '@/features/ide-react/components/rail/rail-panel-header'
import { useTranslation } from 'react-i18next'
import SymbolPaletteContent from './symbol-palette-content'
import SymbolPaletteSettings from './symbol-palette-settings'
import { SymbolPaletteConfigProvider } from '../context/symbol-palette-context'

export default function SymbolPalettePanel() {
    const { t } = useTranslation()
    const [showSettings, setShowSettings] = useState(false)

    const handleSelect = (symbol) => {
        window.dispatchEvent(new CustomEvent('editor:insert-symbol', { detail: symbol }))
    }

    return (
        <SymbolPaletteConfigProvider>
            <div className="symbol-palette-rail-panel">
                <RailPanelHeader
                    title={t('symbol_palette')}
                    actions={
                        <button
                            type="button"
                            className="symbol-palette-rail-settings-toggle"
                            onClick={() => setShowSettings(s => !s)}
                            title={t('symbol_palette_settings')}
                            aria-pressed={showSettings}
                        >
                            ⚙
                        </button>
                    }
                />
                <div className="symbol-palette-rail-panel-body">
                    {showSettings ? (
                        <SymbolPaletteSettings />
                    ) : (
                        <SymbolPaletteContent handleSelect={handleSelect} />
                    )}
                </div>
            </div>
        </SymbolPaletteConfigProvider>
    )
}
