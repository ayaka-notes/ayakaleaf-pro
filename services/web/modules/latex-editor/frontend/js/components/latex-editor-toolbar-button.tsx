import { FC } from 'react'
import { useTranslation } from 'react-i18next'
import MaterialIcon from '@/shared/components/material-icon'
import OLButton from '@/shared/components/ol/ol-button'
import getMeta from '@/utils/meta'
import { useFeatureFlag } from '@/shared/context/split-test-context'
import { useEditorOpenDocContext } from '@/features/ide-react/context/editor-open-doc-context'

const equationEditorAvailable = getMeta('ol-latexEditorAvailable')

/**
 * Toolbar button (editor toolbar, end group) that opens the Equation
 * Editor window (draggable, minimizable, non-blocking — see
 * equation-editor-modal.tsx).
 *
 * The button only dispatches the 'latex-editor:open' event; the listener,
 * state and modal live in latex-editor-controller, which is registered via
 * `sourceEditorToolbarComponents` and therefore always mounted — including
 * in the writefull-toolbar-migration cohort, where this end button is not
 * rendered. That keeps the math preview tooltip's "Open in Equation Editor"
 * action working in both toolbar variants.
 *
 * Hidden in the migration cohort (the end-buttons group is not rendered
 * there anyway, but keep the gate here so the component never renders
 * visible UI in that mode).
 */
const LatexEditorToolbarButton: FC = () => {
  const { t } = useTranslation()
  const isToolbarMigration = useFeatureFlag('writefull-toolbar-migration')

  // The Equation Editor only makes sense on .tex files — on .bib (etc.) the
  // button is confusing, so gate on the active document name. (Ported from
  // the experimental fix db31ec1f: the gate must read the open-document
  // NAME state, not the openDoc action's .name which is always 'openDoc'.)
  const { openDocName } = useEditorOpenDocContext()
  const activeFileIsTex = !!openDocName && /\.tex$/i.test(openDocName)

  if (!equationEditorAvailable || !activeFileIsTex || isToolbarMigration) {
    return null
  }

  return (
    <OLButton
      variant="secondary"
      size="sm"
      onClick={() =>
        document.dispatchEvent(
          new CustomEvent('latex-editor:open', {
            bubbles: true,
            detail: { latex: '' },
          })
        )
      }
      aria-label={t('equation_editor')}
    >
      <MaterialIcon
        type="functions"
        unfilled
        accessibilityLabel={t('equation_editor')}
      />
    </OLButton>
  )
}

export default LatexEditorToolbarButton
