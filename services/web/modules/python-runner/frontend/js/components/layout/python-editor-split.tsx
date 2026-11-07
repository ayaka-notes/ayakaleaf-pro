import '../../../stylesheets/python-runner.scss'
import { Panel, PanelGroup } from 'react-resizable-panels'
import { VerticalResizeHandle } from '@/features/ide-react/components/resize/vertical-resize-handle'
import PythonOutputPane from '../editor/python/python-output-pane'
import SourceEditor from '@/features/source-editor/components/source-editor'
import { PythonExecutionProvider } from '../../context/python-execution-context'

export const PythonEditorSplit = () => {
  return (
    <PythonExecutionProvider>
      <PanelGroup
        autoSaveId="ide-redesign-editor-python-output"
        direction="vertical"
        className="ide-redesign-python-editor-split"
      >
        <Panel id="ide-redesign-panel-source-editor-content" order={1}>
          <SourceEditor />
        </Panel>
        <VerticalResizeHandle id="ide-redesign-editor-python-output" />
        <Panel
          id="ide-redesign-panel-python-output"
          order={2}
          defaultSize={35}
          minSize={10}
        >
          <PythonOutputPane />
        </Panel>
      </PanelGroup>
    </PythonExecutionProvider>
  )
}
