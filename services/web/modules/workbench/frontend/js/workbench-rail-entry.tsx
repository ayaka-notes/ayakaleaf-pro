/**
 * Registers the AI assistant rail tab through overleafModuleImports.railEntries.
 */
import './workbench.css'
import { createPortal } from 'react-dom'
import MaterialIcon from '@/shared/components/material-icon'
import getMeta from '@/utils/meta'
import { useWorkbenchSettings } from './context/workbench-settings-context'
import WorkbenchPanel from './components/workbench-panel'
import { WorkbenchDock } from './components/workbench-dock'

function WorkbenchRailPanel() {
  const { panelContainer } = useWorkbenchSettings()
  return (
    <>
      <WorkbenchDock side="left" />
      {createPortal(<WorkbenchPanel />, panelContainer)}
    </>
  )
}

/**
 * Render the filled icon directly because auto_awesome has no unfilled glyph.
 */
function WorkbenchRailIcon({ title }: { open: boolean; title: string }) {
  return (
    <MaterialIcon
      type="auto_awesome"
      className="ide-rail-tab-link-icon"
      accessibilityLabel={title}
    />
  )
}

const workbenchRailEntry = {
  key: 'workbench',
  icon: WorkbenchRailIcon,
  title: 'AI assistant',
  component: <WorkbenchRailPanel />,
  mountOnFirstLoad: true,
  hide: () =>
    !(getMeta('ol-ExposedSettings') as { aiAvailable?: boolean }).aiAvailable,
}

export default workbenchRailEntry
