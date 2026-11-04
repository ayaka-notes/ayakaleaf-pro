/**
 * The assistant's panel: a header with history, new chat, dock side and close,
 * and the chat below it.
 *
 * overleaf-lab (2026-11, merge phase 2): the conversation history lives in the
 * shared browser-side store (issue #119; the SAME IndexedDB the old llm chat
 * pane used, so a user's existing conversations appear here unchanged — that
 * is the migration, and nothing is wiped). "New chat" ARCHIVES the current
 * conversation (it stays switchable in the history menu), it never deletes.
 * Switching a conversation starts a ChatView seeded with the stored turns;
 * tool results and editor context re-attach on the next user message.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { v4 as uuid } from 'uuid'
import type { UIMessage } from 'ai'
import RailPanelHeader from '@/features/ide-react/components/rail/rail-panel-header'
import OLIconButton from '@/shared/components/ol/ol-icon-button'
import OLTooltip from '@/shared/components/ol/ol-tooltip'
import {
  Dropdown,
  DropdownMenu,
  DropdownItem,
} from '@/shared/components/dropdown/dropdown-menu'
import { useEditorViewContext } from '@/features/ide-react/context/editor-view-context'
import { useRailContext } from '@/features/ide-react/context/rail-context'
import { useAssistantDock } from '../assistant-dock-context'
import ChatView from './chat-view'
import {
  conversationById,
  conversationToMarkdown,
  downloadMarkdown,
  flattenMessages,
  hydrateMessages,
  clearAllConversations,
  listConversations,
  removeConversation,
  saveConversation,
} from '../history/chat-history'
import type { StoredConversation } from '../../../llm/frontend/js/utils/llm-chat-storage'

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

function relativeTime(timestamp: number): string {
  const minutes = Math.round((Date.now() - timestamp) / 60000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.round(hours / 24)
  return `${days} d ago`
}

export default function AssistantPanel() {
  const { t } = useTranslation()
  const { view } = useEditorViewContext()
  const { side, moveTo, setOpen } = useAssistantDock()
  const { isOpen, setIsOpen } = useRailContext()

  const [chatId, setChatId] = useState<string>(() => uuid())
  // Seeded turns of the conversation `chatId` shows (undefined = brand-new).
  const [initialMessages, setInitialMessages] = useState<UIMessage[] | undefined>(undefined)
  const [conversations, setConversations] = useState<StoredConversation[]>([])
  const [historyOpen, setHistoryOpen] = useState(false)

  const historyAvailable = useRef(true)
  if (typeof indexedDB === 'undefined') historyAvailable.current = false
  const idb = () => historyAvailable.current

  // Load the project's stored conversations once on mount and start in the
  // most recent one when there is one.
  useEffect(() => {
    let cancelled = false
    if (!idb()) return
    listConversations()
      .then(list => {
        if (cancelled) return
        setConversations(list)
        const latest = list[0]
        if (latest && latest.messages.length) {
          setChatId(latest.id)
          setInitialMessages(hydrateMessages(latest.messages))
        }
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // --- persistence --------------------------------------------------------
  // ChatView reports its live messages; the store write is debounced (streams
  // update constantly) and flushed immediately before a conversation switches
  // or the panel unmounts, so the last turn is never left only in memory.
  const liveMessages = useRef<UIMessage[] | null>(null)
  const liveChatId = useRef(chatId)
  liveChatId.current = chatId
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flush = useCallback((forChatId: string) => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    const messages = liveMessages.current
    if (!idb() || !messages || !messages.length) return
    void saveConversation(forChatId, flattenMessages(messages)).catch(() => undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const scheduleSave = useCallback(
    (messages: UIMessage[]) => {
      liveMessages.current = messages
      if (!idb()) return
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => {
        saveTimer.current = null
        flush(liveChatId.current)
      }, 800)
    },
    [flush]
  )

  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
      flush(liveChatId.current)
    },
    [flush]
  )

  const refreshList = useCallback(async () => {
    if (!idb()) return
    setConversations(await listConversations().catch(() => []))
  }, [])

  // --- conversation actions ------------------------------------------------
  const startNewChat = () => {
    // Archive (flush) the conversation we are leaving, then open a blank one.
    flush(chatId)
    liveMessages.current = null
    setHistoryOpen(false)
    setInitialMessages(undefined)
    setChatId(uuid())
    void refreshList()
  }

  const switchTo = (id: string) => {
    if (id === chatId) {
      setHistoryOpen(false)
      return
    }
    flush(chatId)
    liveMessages.current = null
    const conversation = conversationById(id, conversations)
    setHistoryOpen(false)
    setInitialMessages(
      conversation && conversation.messages.length ? hydrateMessages(conversation.messages) : undefined
    )
    setChatId(id)
  }

  const remove = async (id: string) => {
    await removeConversation(id).catch(() => undefined)
    await refreshList()
    if (id === chatId) {
      // The open conversation was deleted: start a fresh blank chat.
      liveMessages.current = null
      setInitialMessages(undefined)
      setChatId(uuid())
    }
  }

  const clear = async () => {
    await clearAllConversations().catch(() => undefined)
    setConversations([])
    liveMessages.current = null
    setInitialMessages(undefined)
    setChatId(uuid())
    setHistoryOpen(false)
  }

  const exportActive = () => {
    if (liveMessages.current?.length) {
      // Save the current (still-open) conversation under its id for export.
      void saveConversation(chatId, flattenMessages(liveMessages.current))
    }
    const conversation = conversationById(chatId, conversations)
    const toExport =
      conversation ||
      (liveMessages.current?.length
        ? {
            id: chatId,
            title:
              flattenMessages(liveMessages.current).find(m => m.role === 'user')?.content
                ?.split('\n')[0]
                .slice(0, 70) || 'chat',
            updatedAt: Date.now(),
            messages: flattenMessages(liveMessages.current),
          }
        : null)
    if (toExport) {
      const safe = (toExport.title || 'chat').replace(/[^\w.-]+/g, '-').slice(0, 60) || 'chat'
      downloadMarkdown(`ai-chat-${safe}.md`, conversationToMarkdown(toExport))
    }
    setHistoryOpen(false)
  }

  if (!view) return null

  const close = () => {
    setOpen(false)
    // The shared rail header also closes the rail; only right for a left dock
    if (side === 'left') setIsOpen(false)
    else setIsOpen(isOpen)
  }

  const listLabelStyle = {
    padding: '6px 12px',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    opacity: 0.65,
  }

  return (
    <div className="d-flex flex-column h-100" data-assistant-panel="">
      <RailPanelHeader
        title="AI assistant"
        actions={
          <>
            <Dropdown show={historyOpen} onHide={() => setHistoryOpen(false)} onShow={() => setHistoryOpen(true)}>
              <HeaderButton
                id="assistant-history"
                label={t('chat_history', 'Chat history')}
                icon="history"
                onClick={() => setHistoryOpen(open => !open)}
              />
              <DropdownMenu style={{ maxWidth: 330, maxHeight: '60vh', overflowY: 'auto' }}>
                {conversations.length === 0 && (
                  <div style={listLabelStyle}>{t('no_chat_history_yet', 'No archived chats yet')}</div>
                )}
                {conversations.slice(0, 12).map(conversation => (
                  <div key={conversation.id} style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <DropdownItem
                      style={{ flex: 1, textAlign: 'left', minWidth: 0 }}
                      onClick={() => switchTo(conversation.id)}
                    >
                      <span
                        style={{
                          display: 'block',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          fontWeight: conversation.id === chatId ? 600 : 400,
                        }}
                        title={conversation.title}
                      >
                        {conversation.title}
                      </span>
                      <span style={{ fontSize: 11, opacity: 0.65 }}>
                        {conversation.messages.length} {t('messages', 'messages')} ·{' '}
                        {relativeTime(conversation.updatedAt)}
                      </span>
                    </DropdownItem>
                    <OLIconButton
                      size="sm"
                      icon="delete"
                      unfilled
                      accessibilityLabel={t('delete_chat', 'Delete this chat')}
                      onClick={() => remove(conversation.id)}
                    />
                  </div>
                ))}
                {conversations.length > 12 && (
                  <div style={listLabelStyle}>+{conversations.length - 12} {t('older', 'older')}</div>
                )}
                <hr className="dropdown-divider" />
                <DropdownItem disabled={conversations.length === 0 && !liveMessages.current?.length} onClick={exportActive}>
                  {t('export_markdown', 'Export chat as Markdown')}
                </DropdownItem>
                <DropdownItem
                  disabled={conversations.length === 0}
                  onClick={clear}
                  style={{ color: 'var(--error-color, #dc3545)' }}
                >
                  {t('clear_all_chats', 'Clear all chats…')}
                </DropdownItem>
              </DropdownMenu>
            </Dropdown>
            <HeaderButton
              id="assistant-new-chat"
              label={t('start_new_chat', 'New chat (archives the current one)')}
              icon="edit_square"
              unfilled
              onClick={startNewChat}
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
        <ChatView
          chatId={chatId}
          view={view}
          key={chatId}
          initialMessages={initialMessages}
          onMessages={scheduleSave}
        />
      </div>
    </div>
  )
}
