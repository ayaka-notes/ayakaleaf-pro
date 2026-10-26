/**
 * The assistant's panel: a header with new chat, dock side and close, and
 * the chat below it. A new chat is a fresh ChatView under a new id.
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { v4 as uuid } from 'uuid'
import RailPanelHeader from '@/features/ide-react/components/rail/rail-panel-header'
import OLIconButton from '@/shared/components/ol/ol-icon-button'
import OLTooltip from '@/shared/components/ol/ol-tooltip'
import { useEditorViewContext } from '@/features/ide-react/context/editor-view-context'
import { useRailContext } from '@/features/ide-react/context/rail-context'
import { useAssistantDock } from '../assistant-dock-context'
import ChatView from './chat-view'

function HeaderButton({
  id,
  label,
  icon,
  unfilled = false,
  onClick,
}: {
  id: string
  label: string
  icon: string
  unfilled?: boolean
  onClick: () => void
}) {
  return (
    <OLTooltip id={id} description={label} overlayProps={{ placement: 'bottom' }}>
      <OLIconButton
        className="rail-panel-header-button-subdued"
        size="sm"
        icon={icon}
        unfilled={unfilled as any}
        accessibilityLabel={label}
        onClick={onClick}
      />
    </OLTooltip>
  )
}

export default function AssistantPanel() {
  const { t } = useTranslation()
  const { view } = useEditorViewContext()
  const { side, moveTo, setOpen } = useAssistantDock()
  const { isOpen, setIsOpen } = useRailContext()
  const [chatId, setChatId] = useState(() => uuid())

  if (!view) return null

  const close = () => {
    setOpen(false)
    // The shared rail header also closes the rail; only right for a left dock
    if (side === 'left') setIsOpen(false)
    else setIsOpen(isOpen)
  }

  return (
    <div className="d-flex flex-column h-100" data-assistant-panel="">
      <RailPanelHeader
        title="AI assistant"
        actions={
          <>
            <HeaderButton
              id="assistant-new-chat"
              label={t('start_new_chat')}
              icon="edit_square"
              unfilled
              onClick={() => setChatId(uuid())}
            />
            <HeaderButton
              id="assistant-dock-side"
              label={side === 'left' ? t('move_to_the_right') : t('move_to_the_left')}
              icon={side === 'left' ? 'dock_to_left' : 'dock_to_right'}
              onClick={() => moveTo(side === 'left' ? 'right' : 'left')}
            />
          </>
        }
        onClose={close}
      />
      <div className="flex-grow-1 overflow-hidden" style={{ minHeight: 0 }}>
        <ChatView chatId={chatId} view={view} key={chatId} />
      </div>
    </div>
  )
}
