import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import PropTypes from 'prop-types'
import useSymbolRecognition from '../hooks/use-symbol-recognition'
import { toPaletteSymbols } from '../recognition/candidates'
import spriteSheet from '../recognition/sprite-sheet'
import SymbolPaletteItems from './symbol-palette-items'

export default function SymbolPaletteDraw({ handleSelect }) {
  const { t } = useTranslation()
  const { status, recognize, retry } = useSymbolRecognition()
  const canvasRef = useRef(null)
  const strokesRef = useRef([])
  const pointerRef = useRef(null)
  const generationRef = useRef(0)
  const [revision, setRevision] = useState(0)
  const [hasStrokes, setHasStrokes] = useState(false)
  const [items, setItems] = useState([])
  const [recognizing, setRecognizing] = useState(false)

  const repaint = useCallback(() => {
    const canvas = canvasRef.current
    const context = canvas.getContext('2d')
    context.clearRect(0, 0, canvas.width, canvas.height)
    context.strokeStyle = context.fillStyle = '#222'
    context.lineWidth = 4
    context.lineCap = context.lineJoin = 'round'
    for (const stroke of strokesRef.current) {
      context.beginPath()
      if (stroke.length === 1) {
        context.arc(...stroke[0], 2, 0, 2 * Math.PI)
        context.fill()
      } else {
        context.moveTo(...stroke[0])
        for (const point of stroke.slice(1)) context.lineTo(...point)
        context.stroke()
      }
    }
  }, [])

  const pointFromEvent = event => {
    const canvas = canvasRef.current
    const rect = canvas.getBoundingClientRect()
    return [
      ((event.clientX - rect.left) * canvas.width) / rect.width,
      ((event.clientY - rect.top) * canvas.height) / rect.height,
    ]
  }

  const handlePointerDown = event => {
    if (event.button !== 0 || pointerRef.current !== null) return
    event.preventDefault()
    generationRef.current++
    pointerRef.current = event.pointerId
    strokesRef.current.push([pointFromEvent(event)])
    event.currentTarget.setPointerCapture(event.pointerId)
    setHasStrokes(true)
    repaint()
  }

  const handlePointerMove = event => {
    if (event.pointerId !== pointerRef.current) return
    const events = event.nativeEvent.getCoalescedEvents?.() || []
    const stroke = strokesRef.current[strokesRef.current.length - 1]
    for (const sample of events.length ? events : [event]) {
      stroke.push(pointFromEvent(sample))
    }
    repaint()
  }

  const finishStroke = event => {
    if (event.pointerId !== pointerRef.current) return
    if (event.type === 'pointerup') {
      // A quick stroke may end before the browser delivers a pointermove.
      const stroke = strokesRef.current[strokesRef.current.length - 1]
      const point = pointFromEvent(event)
      const last = stroke[stroke.length - 1]
      if (point[0] !== last[0] || point[1] !== last[1]) stroke.push(point)
    }
    // Losing capture ends drawing, but must not erase the user's existing ink.
    pointerRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    setHasStrokes(strokesRef.current.length > 0)
    setRevision(value => value + 1)
    repaint()
  }

  useEffect(() => {
    if (status !== 'ready' || pointerRef.current !== null) return
    if (!strokesRef.current.length) {
      setItems([])
      setRecognizing(false)
      return
    }
    let cancelled = false
    const generation = generationRef.current
    setRecognizing(true)
    recognize(strokesRef.current).then(candidates => {
      // A cleared canvas or a newly started stroke invalidates an earlier result.
      if (cancelled || generation !== generationRef.current) return
      setItems(toPaletteSymbols(candidates))
      setRecognizing(false)
    })
    return () => {
      cancelled = true
    }
  }, [revision, status, recognize])

  const clear = () => {
    generationRef.current++
    pointerRef.current = null
    strokesRef.current = []
    setItems([])
    setHasStrokes(false)
    setRecognizing(false)
    setRevision(value => value + 1)
    repaint()
  }
  const focusCanvas = useCallback(() => canvasRef.current.focus(), [])

  return (
    <div className="symbol-palette-draw">
      <div className="symbol-palette-draw-results" aria-busy={recognizing}>
        {!hasStrokes ? (
          <p className="symbol-palette-draw-instructions">
            {t('symbol_palette_draw_instructions')}
          </p>
        ) : items.length ? (
          <SymbolPaletteItems
            items={items}
            handleSelect={handleSelect}
            focusInput={focusCanvas}
            ariaLabel={t('symbol_palette_recognised_symbols')}
            spriteSheet={spriteSheet}
          />
        ) : status === 'ready' && !recognizing ? (
          <p className="symbol-palette-draw-instructions">
            {t('no_symbols_found')}
          </p>
        ) : null}
      </div>
      <div className="symbol-palette-draw-canvas-panel">
        <canvas
          ref={canvasRef}
          className="symbol-palette-draw-canvas"
          width={400}
          height={400}
          tabIndex={0}
          aria-label={t('symbol_palette_draw_a_symbol')}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={finishStroke}
          onPointerCancel={finishStroke}
          onLostPointerCapture={finishStroke}
        />
        <div className="symbol-palette-draw-toolbar">
          <button
            type="button"
            className="symbol-palette-draw-clear"
            onClick={clear}
            disabled={!hasStrokes}
          >
            {t('clear')}
          </button>
          <span role="status">
            {status === 'loading' && t('symbol_palette_loading_model')}
            {status === 'error' && t('symbol_palette_recognition_unavailable')}
          </span>
          {status === 'error' && (
            <button
              type="button"
              className="symbol-palette-draw-clear"
              onClick={retry}
            >
              {t('try_again')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

SymbolPaletteDraw.propTypes = {
  handleSelect: PropTypes.func.isRequired,
}
