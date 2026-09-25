import { useCallback } from 'react'
import {
  useCodeMirrorStateContext,
  useCodeMirrorViewContext,
} from '@/features/source-editor/components/codemirror-context'
import { useEditorOpenDocContext } from '@/features/ide-react/context/editor-open-doc-context'
import { usePermissionsContext } from '@/features/ide-react/context/permissions-context'
import { BibtexEditor } from './components/BibtexEditor'
import BibtexEditorSwitch from './components/BibtexEditorSwitch'

// Bridges the open .bib document to the visual editor. Core renders this in
// place of CodeMirror (which stays mounted but hidden) when the Visual toggle
// is on, so we read the text from the CodeMirror doc and write edits back with
// a transaction — changes then flow through the normal OT / sync path.
function BibtexVisualEditor() {
  const state = useCodeMirrorStateContext()
  const view = useCodeMirrorViewContext()
  const { openDocName } = useEditorOpenDocContext()
  const permissions = usePermissionsContext()
  const canEdit = permissions.write || permissions.trackedWrite

  const value = state.doc.toString()

  const onChange = useCallback(
    (next: string) => {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: next },
      })
    },
    [view]
  )

  return (
    <BibtexEditor
      value={value}
      onChange={onChange}
      readOnly={!canEdit}
      fileName={openDocName ?? undefined}
      toolbar={<BibtexEditorSwitch />}
    />
  )
}

// Registered via overleafModuleImports.visualEditorProviders. The core
// source-editor (utils/visual-editor.ts) queries these named exports to light
// up the Code/Visual toggle for .bib files and to render our component.
export const id = 'bibtex'

export function isVisualEditorAvailable(filename: string): boolean {
  return /\.bib$/i.test(filename)
}

export function getVisualEditorComponent(filename: string) {
  return isVisualEditorAvailable(filename) ? BibtexVisualEditor : null
}
