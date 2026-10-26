/**
 * Hosts the AI conversation in the editor rail and provides docking controls.
 * Starting a new chat changes the chat ID to reset conversation state.
 */
import { memo, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Tab } from 'react-bootstrap'
import { v4 as uuid } from 'uuid'
import RailPanelHeader from '@/features/ide-react/components/rail/rail-panel-header'
import OLIconButton from '@/shared/components/ol/ol-icon-button'
import OLTooltip from '@/shared/components/ol/ol-tooltip'
import { useEditorViewContext } from '@/features/ide-react/context/editor-view-context'
import { useRailContext } from '@/features/ide-react/context/rail-context'
import { sendMB } from '@/infrastructure/event-tracking'
import type { EditorView } from '@codemirror/view'
import { useWorkbenchSettings } from '../context/workbench-settings-context'
import WorkbenchChat from './workbench-chat'

/** Dock-side switcher. */
const SideSelector = memo(function SideSelector() {
  const { position, setPosition, setOpen } = useWorkbenchSettings()
  const { openTab, selectTab, setIsOpen } = useRailContext()
  const { t } = useTranslation()
  const handleClick = useCallback(() => {
    const toLeft = position === 'right'
    setPosition(toLeft ? 'left' : 'right')
    setOpen(true)
    if (toLeft) {
      openTab('workbench')
    } else {
      selectTab('file-tree')
      setIsOpen(false)
    }
  }, [position, setOpen, setPosition, openTab, selectTab, setIsOpen])
  return (
    <OLTooltip
      id="workbench-side-selector"
      description={
        position === 'left' ? t('move_to_the_right') : t('move_to_the_left')
      }
      overlayProps={{ placement: 'bottom' }}
    >
      <OLIconButton
        className="rail-panel-header-button-subdued"
        onClick={handleClick}
        icon={position === 'left' ? 'dock_to_left' : 'dock_to_right'}
        size="sm"
      />
    </OLTooltip>
  )
})

/** New-chat button. */
const NewChatButton = ({ onClick }: { onClick: () => void }) => {
  const { t } = useTranslation()
  return (
    <OLTooltip
      id="start-new-chat"
      description={t('start_new_chat')}
      overlayProps={{ placement: 'bottom' }}
      key="new-chat"
    >
      <OLIconButton
        className="rail-panel-header-button-subdued"
        onClick={onClick}
        icon="edit_square"
        size="sm"
        unfilled
      />
    </OLTooltip>
  )
}

export default function WorkbenchPanel() {
  const { view } = useEditorViewContext()
  if (view) {
    return <WorkbenchPanelInner view={view} />
  }
  return null
}

const WorkbenchPanelInner = memo(function WorkbenchPanelInner({
  view,
}: {
  view: EditorView
}) {
  const { t } = useTranslation()
  const { position, setOpen } = useWorkbenchSettings()
  const { isOpen, setIsOpen } = useRailContext()
  const [chatId, setChatId] = useState(() => uuid())

  const handleNewChat = useCallback(() => {
    const newChatId = uuid()
    setChatId(newChatId)
    sendMB('ai-chat', {
      type: 'button',
      action: 'start-new-chat',
      chatId: newChatId,
    })
  }, [])

  const handleClose = useCallback(() => {
    setOpen(false)
    // The shared header closes the left rail too; preserve it for a right dock.
    setIsOpen(position === 'left' ? false : isOpen)
    sendMB('ai-chat', { type: 'button', action: 'close', chatId })
  }, [chatId, position, setOpen, isOpen, setIsOpen])

  return (
    <div className="workbench-panel">
      <RailPanelHeader
        title={
          <span className="workbench-panel-title-inner">
            <span>AI assistant</span>
          </span>
        }
        actions={
          <>
            <NewChatButton onClick={handleNewChat} />
            <SideSelector />
          </>
        }
        onClose={handleClose}
      />
      <Tab.Container
        mountOnEnter
        unmountOnExit={false}
        transition={false}
        activeKey="chat"
        id="workbench-tabs"
      >
        <Tab.Content className="workbench-tab-content">
          <Tab.Pane
            eventKey="chat"
            mountOnEnter={false}
            className="workbench-tab-pane workbench-chat-pane"
            key="chat"
          >
            <WorkbenchChat chatId={chatId} view={view} key={chatId} />
          </Tab.Pane>
        </Tab.Content>
      </Tab.Container>
    </div>
  )
})
