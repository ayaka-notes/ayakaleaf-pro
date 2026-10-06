import { useLayoutEffect, useRef } from 'react'
import { Panel } from 'react-resizable-panels'
import { HorizontalResizeHandle } from '@/features/ide-react/components/resize/horizontal-resize-handle'
import { useRailContext } from '@/features/ide-react/context/rail-context'
import { useLayoutContext } from '@/shared/context/layout-context'
import getMeta from '@/utils/meta'
import {
  useWorkbenchSettings,
  type WorkbenchPosition,
} from '../context/workbench-settings-context'

export function WorkbenchDock({ side }: { side: WorkbenchPosition }) {
  const { position, panelContainer } = useWorkbenchSettings()
  const ref = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const target = ref.current
    if (position !== side || !target) return
    target.appendChild(panelContainer)
    return () => {
      if (panelContainer.parentNode === target) {
        target.removeChild(panelContainer)
      }
    }
  }, [position, side, panelContainer])

  return <div ref={ref} className="h-100" />
}

export default function WorkbenchRightPanel({ order }: { order: number }) {
  const { position, open } = useWorkbenchSettings()
  const { view, focusMode } = useLayoutContext()
  const { setResizing } = useRailContext()
  const { aiAvailable } = getMeta('ol-ExposedSettings') as { aiAvailable?: boolean }

  if (!aiAvailable || position !== 'right' || !open || focusMode || view === 'history') {
    return null
  }

  return (
    <>
      <HorizontalResizeHandle onDragging={setResizing} />
      <Panel
        id="ide-workbench-right-panel"
        order={order}
        defaultSize={25}
        minSize={15}
        maxSize={60}
      >
        <WorkbenchDock side="right" />
      </Panel>
    </>
  )
}
