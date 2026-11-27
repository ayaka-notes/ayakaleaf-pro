import { FC, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { EquationEditorModal } from './equation-editor-modal'

/**
 * Portal wrapper that renders the editor window into document.body so
 * it stays above the toolbar/editor layers and its position:fixed
 * children (search dropdowns, virtual keyboard) are not clipped.
 */
const EquationEditorPortal: FC<{
  onInsert: (latex: string) => void
  onImport: () => string
  onClose: () => void
  initialLatex?: string
}> = ({ onInsert, onImport, onClose, initialLatex }) => {
  const [container] = useState(() => {
    let el = document.getElementById('latex-editor-modal-root')
    if (!el) {
      el = document.createElement('div')
      el.id = 'latex-editor-modal-root'
      document.body.appendChild(el)
    }
    return el
  })

  // Remove the (now empty) container on unmount
  useEffect(() => {
    return () => {
      const el = document.getElementById('latex-editor-modal-root')
      if (
        el &&
        el.parentElement === document.body &&
        el.querySelector('.latex-editor-modal') === null
      ) {
        el.remove()
      }
    }
  }, [])

  return createPortal(
    <EquationEditorModal
      onInsert={onInsert}
      onImport={onImport}
      onClose={onClose}
      initialLatex={initialLatex}
    />,
    container
  )
}

export default EquationEditorPortal
