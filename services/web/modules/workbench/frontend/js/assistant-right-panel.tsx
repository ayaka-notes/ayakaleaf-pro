/**
 * The right-hand panel of the editor layout that holds the assistant when it
 * is docked on the right.
 */
import { Panel } from 'react-resizable-panels'
import { HorizontalResizeHandle } from '@/features/ide-react/components/resize/horizontal-resize-handle'
import { useRailContext } from '@/features/ide-react/context/rail-context'
import { useLayoutContext } from '@/shared/context/layout-context'
import getMeta from '@/utils/meta'
import { DockSlot, useAssistantDock } from './assistant-dock-context'

export default function AssistantRightPanel({ order }: { order: number }) {
  const { side, open } = useAssistantDock()
  const { view, focusMode } = useLayoutContext()
  const { setResizing } = useRailContext()
  const { aiAvailable } = getMeta('ol-ExposedSettings') as { aiAvailable?: boolean }

  if (!aiAvailable || side !== 'right' || !open || focusMode || view === 'history') {
    return null
  }
  return (
    <>
      <HorizontalResizeHandle onDragging={setResizing} />
      <Panel id="assistant-right-panel" order={order} defaultSize={25} minSize={15} maxSize={60}>
        <DockSlot side="right" />
      </Panel>
    </>
  )
}
