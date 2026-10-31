import { FC, useCallback, useState } from 'react'
import { useCodeMirrorViewContext } from '@/features/source-editor/components/codemirror-context'
import { useEditorOpenDocContext } from '@/features/ide-react/context/editor-open-doc-context'
import { postJSON } from '@/infrastructure/fetch-json'
import MaterialIcon from '@/shared/components/material-icon'
import OLTooltip from '@/shared/components/ol/ol-tooltip'

/**
 * Toolbar button that formats the current document.
 * Uses tex-fmt for .tex/.cls/.sty files and bibtex-tidy for .bib files.
 *
 * tex-fmt: https://github.com/WGUNDERWOOD/tex-fmt
 * bibtex-tidy: https://github.com/FlamingTempura/bibtex-tidy
 */
const AutoformatButton: FC = () => {
  const view = useCodeMirrorViewContext()
  const { openDocName } = useEditorOpenDocContext()
  const [formatting, setFormatting] = useState(false)

  const handleClick = useCallback(async () => {
    if (formatting) return

    const content = view.state.doc.toString()
    if (!content.trim()) return

    setFormatting(true)
    try {
      const { formatted } = await postJSON<{ formatted: string }>(
        '/api/format-tex',
        { body: { content, filename: openDocName || '' } }
      )

      if (formatted !== content) {
        view.dispatch({
          changes: {
            from: 0,
            to: view.state.doc.length,
            insert: formatted,
          },
        })
      }
    } catch (err) {
      console.error('tex-fmt formatting failed:', err)
    } finally {
      setFormatting(false)
      view.focus()
    }
  }, [view, formatting, openDocName])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
  }, [])

  return (
    <OLTooltip
      id="toolbar-format-tex"
      description="Auto-format document (tex-fmt)"
      overlayProps={{ placement: 'bottom' }}
    >
      <button
        className="ol-cm-toolbar-button"
        aria-label="Auto-format document"
        onMouseDown={handleMouseDown}
        onClick={handleClick}
        aria-disabled={formatting}
        type="button"
      >
        <MaterialIcon
          type={formatting ? 'hourglass_empty' : 'auto_fix_high'}
          accessibilityLabel="Auto-format document"
        />
      </button>
    </OLTooltip>
  )
}

export default AutoformatButton
