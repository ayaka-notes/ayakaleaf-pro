/**
 * The assistant's tab in the editor rail (overleafModuleImports.railEntries).
 * The rail key stays 'workbench', which the core rail expects for this tab.
 */
import { createPortal } from 'react-dom'
import MaterialIcon from '@/shared/components/material-icon'
import getMeta from '@/utils/meta'
import { DockSlot, useAssistantDock } from './assistant-dock-context'
import AssistantPanel from './chat/assistant-panel'

function RailContent() {
  const { host } = useAssistantDock()
  return (
    <>
      <DockSlot side="left" />
      {createPortal(<AssistantPanel />, host)}
    </>
  )
}

function RailIcon({ title }: { open: boolean; title: string }) {
  return <MaterialIcon type="auto_awesome" className="ide-rail-tab-link-icon" accessibilityLabel={title} />
}

export default {
  key: 'workbench',
  icon: RailIcon,
  title: 'AI assistant',
  component: <RailContent />,
  mountOnFirstLoad: true,
  hide: () => !(getMeta('ol-ExposedSettings') as { aiAvailable?: boolean }).aiAvailable,
}
