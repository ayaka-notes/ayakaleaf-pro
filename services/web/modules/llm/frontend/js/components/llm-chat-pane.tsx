import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import MaterialIcon from '@/shared/components/material-icon'
import { useLLMChat } from '../hooks/use-llm-chat'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import '../../stylesheets/llm-chat.scss'

interface LLMChatPaneProps {
    isOpen?: boolean
    setIsOpen?: (open: boolean) => void
}

const LLMChatPane = React.memo(function LLMChatPane({
    isOpen,
    setIsOpen,
}: LLMChatPaneProps) {
    const { t } = useTranslation()
    const inputRef = useRef<HTMLTextAreaElement>(null)
    const {
        messages,
        isLoading,
        sendMessage,
        stopGeneration,
        rerunLastMessage,
        clearMessages,
        canRerun,
        modelsLoaded,
        hasModels,
        // overleaf-lab (issue #119): browser-side conversation history.
        conversations,
        activeConversationId,
        switchConversation,
        deleteConversation,
        clearAllHistory,
        exportConversation,
    } = useLLMChat()

    const [inputValue, setInputValue] = useState('')

    // Close chat panel if models become unavailable (only when controlled externally)
    useEffect(() => {
        if (modelsLoaded && !hasModels && isOpen === true && setIsOpen) {
            setIsOpen(false)
        }
    }, [modelsLoaded, hasModels, isOpen, setIsOpen])

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault()
        if (inputValue.trim() && !isLoading) {
            sendMessage(inputValue)
            setInputValue('')
        }
    }

    const handleStop = () => {
        stopGeneration()
    }

    const handleRerun = () => {
        rerunLastMessage()
    }

    // overleaf-lab (issue #119): "clear" now MEANS "start a new chat" — the old
    // thread is archived into the history list instead of being destroyed.
    // Kept the two-click arm pattern (it protects against fat-fingers).
    const [armedNew, setArmedNew] = useState(false)
    const armedTimer = useRef<number | null>(null)
    const [armedClearAll, setArmedClearAll] = useState(false)
    const clearAllTimer = useRef<number | null>(null)
    const [historyOpen, setHistoryOpen] = useState(false)
    const historyMenuRef = useRef<HTMLDivElement | null>(null)

    // clear the disarm timers on unmount (no setState-after-unmount)
    useEffect(() => () => {
        if (armedTimer.current) window.clearTimeout(armedTimer.current)
        if (clearAllTimer.current) window.clearTimeout(clearAllTimer.current)
    }, [])
    const armNew = () => {
        setArmedNew(true)
        if (armedTimer.current) window.clearTimeout(armedTimer.current)
        armedTimer.current = window.setTimeout(() => setArmedNew(false), 3000)
    }
    const handleNewChat = () => {
        if (displayMessages.length > 0 && !armedNew) {
            armNew()
            return
        }
        if (armedTimer.current) window.clearTimeout(armedTimer.current)
        setArmedNew(false)
        setHistoryOpen(false)
        clearMessages()
    }
    const handleClearAllHistory = () => {
        if (!armedClearAll) {
            setArmedClearAll(true)
            if (clearAllTimer.current) window.clearTimeout(clearAllTimer.current)
            clearAllTimer.current = window.setTimeout(() => setArmedClearAll(false), 3000)
            return
        }
        if (clearAllTimer.current) window.clearTimeout(clearAllTimer.current)
        setArmedClearAll(false)
        setHistoryOpen(false)
        void clearAllHistory()
    }

    // overleaf-lab (issue #119): close the history menu on outside click / Esc.
    useEffect(() => {
        if (!historyOpen) return
        const onDown = (e: MouseEvent) => {
            if (historyMenuRef.current && !historyMenuRef.current.contains(e.target as Node)) {
                setHistoryOpen(false)
            }
        }
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setHistoryOpen(false)
        }
        document.addEventListener('mousedown', onDown)
        document.addEventListener('keydown', onKey)
        return () => {
            document.removeEventListener('mousedown', onDown)
            document.removeEventListener('keydown', onKey)
        }
    }, [historyOpen])

    // overleaf-lab (issue #119): compact relative time for the history list.
    const relTime = (ts: number): string => {
        const diff = Date.now() - ts
        const m = Math.floor(diff / 60000)
        if (m < 1) return t('llm_hist_now', 'just now')
        if (m < 60) return t('llm_hist_minutes', '{{m}} min ago', { m })
        const h = Math.floor(m / 60)
        if (h < 24) return t('llm_hist_hours', '{{h}} h ago', { h })
        const d = Math.floor(h / 24)
        if (d < 7) return t('llm_hist_days', '{{d}} d ago', { d })
        return new Date(ts).toLocaleDateString()
    }

    const activeTitle = conversations
        ? (conversations.find(c => c.id === activeConversationId) || null)
        : null

    if (modelsLoaded && !hasModels) {
        return null
    }

    if (isOpen === false) {
        return null
    }

    const displayMessages = messages.filter(m => m.role !== 'system')

    return (
        <aside className="chat" aria-label={t('ai_assistant', 'AI Assistant')}>
            <div className="llm-chat-container">
                {/* overleaf-lab (owner request 2026-08-26): the per-pane model picker is
                    gone — the ONLY selection entry point is File → "Select LLM Model".
                    The chat keeps using the shared (user-scoped) selection, synced
                    inside use-llm-chat via the LLM_MODEL_CHANGED_EVENT bridge. */}
                <div className="llm-chat-header">
                    <div className="llm-chat-header-title" title={activeTitle?.title || undefined}>
                        <span className="llm-chat-header-label">
                            {activeTitle?.title || t('new_chat', 'New chat')}
                        </span>
                    </div>
                    <div className="llm-action-buttons">
                        {canRerun && !isLoading && (
                            <button
                                type="button"
                                onClick={handleRerun}
                                className="llm-action-button"
                                title={t('re_run_last_question', 'Re-run last question')}
                                aria-label={t('re_run_last_question', 'Re-run last question')}
                            >
                                <MaterialIcon type="refresh" />
                            </button>
                        )}

                        {displayMessages.length > 0 && !isLoading && (
                            <button
                                type="button"
                                onClick={handleNewChat}
                                className={`llm-action-button${armedNew ? ' llm-action-button-armed' : ''}`}
                                title={armedNew
                                    ? t('llm_chat_confirm_new', 'Click again to start a new chat (this one is kept in history)')
                                    : t('new_chat_archive', 'New chat (this one is kept in history)')}
                                aria-label={t('new_chat_archive', 'New chat (this one is kept in history)')}
                            >
                                {armedNew ? (
                                    <span className="llm-action-button-text">
                                        {t('llm_chat_confirm_new_text', 'New chat?')}
                                    </span>
                                ) : (
                                    <MaterialIcon type="add_comment" />
                                )}
                            </button>
                        )}

                        {/* overleaf-lab (issue #119): history list — previous
                            conversations survive refreshes / "new chat" and can
                            be reopened, exported, or deleted individually. */}
                        <div className="llm-history-wrap" ref={historyMenuRef}>
                            <button
                                type="button"
                                onClick={() => setHistoryOpen(o => !o)}
                                className={`llm-action-button${historyOpen ? ' llm-action-button-active' : ''}`}
                                title={t('chat_history', 'Chat history')}
                                aria-label={t('chat_history', 'Chat history')}
                                aria-expanded={historyOpen}
                            >
                                <MaterialIcon type="history" />
                                {conversations.length > 0 && (
                                    <span className="llm-history-badge">{conversations.length}</span>
                                )}
                            </button>

                            {historyOpen && (
                                <div className="llm-history-menu" role="menu" aria-label={t('chat_history', 'Chat history')}>
                                    {conversations.length === 0 ? (
                                        <div className="llm-history-empty">
                                            {t('llm_hist_empty', 'No saved conversations yet. Chat history is stored in this browser only.')}
                                        </div>
                                    ) : (
                                        <ul className="llm-history-list">
                                            {conversations.map(c => (
                                                <li key={c.id} className={`llm-history-row${c.id === activeConversationId ? ' llm-history-row-active' : ''}`}>
                                                    <button
                                                        type="button"
                                                        className="llm-history-row-main"
                                                        onClick={() => {
                                                            setHistoryOpen(false)
                                                            if (c.id !== activeConversationId) switchConversation(c.id)
                                                        }}
                                                    >
                                                        <span className="llm-history-row-title">{c.title}</span>
                                                        <span className="llm-history-row-meta">
                                                            {relTime(c.updatedAt)}
                                                            {' · '}
                                                            {c.count} {t('llm_hist_msgs', 'msg')}
                                                        </span>
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className="llm-history-row-delete"
                                                        title={t('delete_conversation', 'Delete this conversation')}
                                                        aria-label={t('delete_conversation', 'Delete this conversation')}
                                                        onClick={() => deleteConversation(c.id)}
                                                    >
                                                        <MaterialIcon type="close" />
                                                    </button>
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                    <div className="llm-history-footer">
                                        {displayMessages.length > 0 && (
                                            <button
                                                type="button"
                                                className="llm-history-footer-btn"
                                                onClick={() => {
                                                    setHistoryOpen(false)
                                                    exportConversation()
                                                }}
                                            >
                                                <MaterialIcon type="download" />
                                                {t('export_chat', 'Export as Markdown')}
                                            </button>
                                        )}
                                        {conversations.length > 0 && (
                                            <button
                                                type="button"
                                                className={`llm-history-footer-btn${armedClearAll ? ' llm-history-footer-btn-armed' : ''}`}
                                                onClick={handleClearAllHistory}
                                            >
                                                {armedClearAll
                                                    ? t('llm_hist_clear_all_confirm', 'Delete ALL?')
                                                    : t('llm_hist_clear_all', 'Clear all history')}
                                            </button>
                                        )}
                                    </div>
                                    <p className="llm-history-note">
                                        {t('llm_hist_note', 'Stored in this browser only (IndexedDB) — not on the server.')}
                                    </p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>

                {displayMessages.length === 0 ? (
                    <div className="llm-chat-welcome">
                        <MaterialIcon type="smart_toy" className="llm-welcome-icon" />
                        <h3>{t('latex_ai_assistant', 'LaTeX AI Assistant')}</h3>
                        <p>
                            {t(
                                'ai_assistant_description',
                                'Ask questions about LaTeX, get help with errors, and more.'
                            )}
                        </p>
                        <div className="llm-suggestions">
                            <p className="llm-suggestions-title">
                                {t('try_asking', 'Try asking')}:
                            </p>
                            <ul>
                                <li>"How do I create a table?"</li>
                                <li>"Help me fix this equation"</li>
                                <li>"How to add bibliography?"</li>
                                <li>"Explain this LaTeX command"</li>
                            </ul>
                        </div>
                    </div>
                ) : (
                    <div className="llm-chat-messages">
                        {displayMessages.map((msg, idx) => (
                            <div
                                key={idx}
                                className={`llm-message llm-message-${msg.role}`}
                            >
                                <div className="message-container">
                                    <div
                                        className="message-content"
                                        // Content is LLM output (attacker-influenceable via the
                                        // document, so sanitize after markdown). See F3.
                                        // eslint-disable-next-line react/no-danger
                                        dangerouslySetInnerHTML={{
                                            __html: DOMPurify.sanitize(
                                                marked.parse(msg.content) as string,
                                                { USE_PROFILES: { html: true, svg: false, mathMl: false } }
                                            ),
                                        }}
                                    />
                                </div>
                            </div>
                        ))}
                        {isLoading && (
                            <div className="llm-message llm-message-assistant">
                                <div className="message-container">
                                    <div className="llm-message-loading">
                                        <MaterialIcon
                                            type="smart_toy"
                                            className="loading-icon"
                                        />
                                        <span>{t('thinking', 'Thinking...')}</span>
                                        <button
                                            type="button"
                                            onClick={handleStop}
                                            className="llm-stop-button"
                                            title={t('stop_generation', 'Stop')}
                                            aria-label={t('stop_generation', 'Stop')}
                                        >
                                            <MaterialIcon type="stop" />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* AI assistant input */}
                <form className="llm-chat-input-form" onSubmit={handleSubmit}>
                    <textarea
                        ref={inputRef}
                        id="llm-chat-input"
                        className="llm-chat-textarea"
                        value={inputValue}
                        onChange={e => setInputValue(e.target.value)}
                        onKeyDown={e => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault()
                                handleSubmit(e as any)
                            }
                        }}
                        placeholder={t(
                            'ask_about_latex_placeholder',
                            'Ask about LaTeX...'
                        )}
                        disabled={isLoading}
                        rows={1}
                        aria-label={t('ai_assistant_input', 'AI assistant input')}
                    />
                    <button
                        type="submit"
                        className="llm-chat-send-button"
                        disabled={isLoading || !inputValue.trim()}
                        aria-label={t('send', 'Send')}
                    >
                        <MaterialIcon type="send" />
                    </button>
                </form>
            </div>
        </aside>
    )
})

export default LLMChatPane
