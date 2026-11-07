import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import PropTypes from 'prop-types'
import { matchSorter } from 'match-sorter'
import symbols from '../data/symbols.json'
import { buildCategorisedSymbols, createCategories } from '../utils/categories'
import SymbolPaletteSearch from './symbol-palette-search'
import SymbolPaletteBody from './symbol-palette-body'
import SymbolPaletteTabs from './symbol-palette-tabs'
import SymbolPaletteCloseButton from './symbol-palette-close-button'
import SymbolPaletteDrawToggle from './symbol-palette-draw-toggle'

const SymbolPaletteDraw = lazy(() => import('./symbol-palette-draw'))

// Recognition rasterises strokes on an OffscreenCanvas in a worker, which
// Safari 15 (still a supported browser) lacks.
const drawingSupported =
  typeof OffscreenCanvas !== 'undefined' &&
  new OffscreenCanvas(1, 1).getContext('2d') !== null

export default function SymbolPaletteContent({ handleSelect }) {
  const [input, setInput] = useState('')
  const [drawing, setDrawing] = useState(false)

  const { t } = useTranslation()

  // build the list of categories with translated labels
  const categories = useMemo(() => createCategories(t), [t])
  const [activeCategoryId, setActiveCategoryId] = useState(categories[0]?.id)

  // group the symbols by category
  const categorisedSymbols = useMemo(
    () => buildCategorisedSymbols(categories),
    [categories]
  )

  // select symbols which match the input
  const filteredSymbols = useMemo(() => {
    if (input === '') {
      return null
    }

    const words = input.trim().split(/\s+/)

    return words.reduceRight(
      (symbols, word) =>
        matchSorter(symbols, word, {
          keys: ['command', 'description', 'character', 'aliases'],
          threshold: matchSorter.rankings.CONTAINS,
        }),
      symbols
    )
  }, [input])

  const inputRef = useRef(null)

  // allow the input to be focused
  const focusInput = useCallback(() => {
    if (inputRef.current) {
      inputRef.current.focus()
    }
  }, [])

  // focus the input when the symbol palette is opened
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus()
    }
  }, [])
  return (
    <div className="symbol-palette-container">
      <div className="symbol-palette">
        <div className="symbol-palette-header-outer">
          <div className="symbol-palette-header">
            <SymbolPaletteTabs
              categories={categories}
              activeCategoryId={activeCategoryId}
              setActiveCategoryId={setActiveCategoryId}
              disabled={drawing}
            />
            <div className="symbol-palette-header-group">
              <SymbolPaletteSearch
                setInput={setInput}
                inputRef={inputRef}
                onFocus={() => setDrawing(false)}
              />
              {drawingSupported && (
                <SymbolPaletteDrawToggle
                  active={drawing}
                  setActive={setDrawing}
                />
              )}
            </div>
          </div>
          <div className="symbol-palette-header-group">
            <SymbolPaletteCloseButton />
          </div>
        </div>
        <div className="symbol-palette-body">
          {drawing ? (
            <Suspense
              fallback={
                <div className="symbol-palette-empty" role="status">
                  {t('symbol_palette_loading_model')}
                </div>
              }
            >
              <SymbolPaletteDraw handleSelect={handleSelect} />
            </Suspense>
          ) : (
            <SymbolPaletteBody
              categories={categories}
              categorisedSymbols={categorisedSymbols}
              filteredSymbols={filteredSymbols}
              handleSelect={handleSelect}
              focusInput={focusInput}
              activeCategoryId={activeCategoryId}
            />
          )}
        </div>
      </div>
    </div>
  )
}
SymbolPaletteContent.propTypes = {
  handleSelect: PropTypes.func.isRequired,
}
