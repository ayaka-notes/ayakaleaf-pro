// overleaf-lab (2026-11, owner request: "give review its own chat history"):
// the AI-check (review) pane previously had NO conversation at all — a one-shot
// rubric run whose results vanished on reload. This is its OWN chat: follow-up
// questions about the document / rubric / results, on the 'review' task lane
// (File → Select LLM Task → Review), with a SEPARATE history store (key
// `<project>/review`) and the same history behaviours the assistant got
// (issue #119: list / switch / new / delete / clear / Markdown export).
//
// It reuses the llm module's chat hook (scope 'review') — zero new server
// surface: POST /llm/chat now accepts the task name (default 'chat' for all
// existing callers; the server resolves the per-task model slot).
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import MaterialIcon from '@/shared/components/material-icon'
import OLButton from '@/shared/components/ol/ol-button'
import OLTooltip from '@/shared/components/ol/ol-tooltip'
import OLIconButton from '@/shared/components/ol/ol-icon-button'
import {
    Dropdown,
    DropdownMenu,
    DropdownItem,
} from '@/shared/components/dropdown/dropdown-menu'
import { useLLMChat } from '../hooks/use-llm-chat'
import { useLLMModelSelection } from '../hooks/use-llm-model-selection'

const REVIEW_SYSTEM_PROMPT = `You are the review assistant for a LaTeX document project.

Your context:
- The project's document and its requirements (the review rubric).
- Past review results in this conversation (status per requirement: ok / partial / missing / N/A, with the evidence and suggestions found).

How to help:
- Answer questions ABOUT the document, the rubric, or a previous review result ("why did X fail?", "how do I fix X?", "what does requirement Y require?").
- Be concrete: quote the requirement, point at the evidence, and suggest a minimal LaTeX-level fix when applicable.
- Use code blocks for LaTeX.
- If you do not know something about this specific document, say so plainly instead of guessing.
- Keep answers focused; this is a project review conversation, not a general chat.`

function relativeTime(ts: number): string {
    const d = Date.now() - ts
    if (d < 60e3) return 'just now'
    if (d < 3600e3) return `${Math.floor(d / 60e3)} min ago`
    if (d < 86400e3) return `${Math.floor(d / 3600e3)} h ago`
    return `${Math.floor(d / 86400e3)} d ago`
}

function LLMReviewChat() {
    const { t } = useTranslation()
    const { selected: sharedModel } = useLLMModelSelection()

    const {
        messages,
        isLoading,
        error,
        sendMessage,
        stopGeneration,
        clearMessages,
        conversations,
        activeConversationId,
        historyReady,
        newConversation,
        switchConversation,
        deleteConversation,
        clearAllHistory,
        exportConversation,
    } = useLLMChat({
        scope: 'review',
        task: 'review',
        systemPrompt: REVIEW_SYSTEM_PROMPT,
    })

    const [input, setInput] = useState('')
    const [menuOpen, setMenuOpen] = useState(false)
    const menuRef = useRef<HTMLUListElement | null>(null)

    // overleaf-lab (2026-11, same lesson as the assistant's z-order fix):
    // the rail panel container has overflow:hidden and is NARROWER than this
    // menu (320px), so the right-edge-anchored menu clipped at the panel's
    // left edge (icon + text cut, editor bleeding through). Position the menu
    // fixed inside the panel bounds (width-capped to the panel) — no clipping,
    // and it still wins the paint order over the editor.
    useLayoutEffect(() => {
        if (!menuOpen) return
        const menu = menuRef.current
        if (!menu) return
        const position = () => {
            const panel =
                document.getElementById('ide-redesign-sidebar-panel-llm-chat') ||
                document.querySelector('[data-review-chat]')
            if (!panel) return
            const bounds = panel.getBoundingClientRect()
            const anchor = document.getElementById('review-history-anchor')
            const top = anchor ? anchor.getBoundingClientRect().bottom + 4 : bounds.top + 40
            const width = Math.min(320, bounds.width - 12)
            menu.style.position = 'fixed'
            menu.style.left = `${Math.round(bounds.left + 6)}px`
            menu.style.top = `${Math.round(top)}px`
            menu.style.width = `${Math.round(width)}px`
            menu.style.maxWidth = `${Math.round(width)}px`
            menu.style.transform = 'none'
        }
        position()
        const close = () => setMenuOpen(false)
        window.addEventListener('resize', close)
        window.addEventListener('scroll', close, true)
        return () => {
            window.removeEventListener('resize', close)
            window.removeEventListener('scroll', close, true)
        }
    }, [menuOpen])

    // auto-scroll on new content
    const scrollRef = useRef<HTMLDivElement | null>(null)
    useEffect(() => {
        const el = scrollRef.current
        if (el) el.scrollTop = el.scrollHeight
    }, [messages, isLoading])

    const submit = (): void => {
        const text = input.trim()
        if (!text || isLoading) return
        setInput('')
        void sendMessage(text)
    }

    const muted =
        'color-mix(in srgb, var(--content-primary-themed) 72%, transparent)'

    return (
        <div
            data-review-chat=""
            style={{
                display: 'flex',
                flexDirection: 'column',
                flex: 1,
                minHeight: 0,
                padding: 12,
                gap: 10,
            }}
        >
            {/* header row: history menu + new chat */}
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <div style={{ fontSize: 12, color: muted, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {t('review_chat_lane', 'Review conversation')}{sharedModel ? ` · ${sharedModel}` : ''}
                </div>
                <Dropdown show={menuOpen} onHide={() => setMenuOpen(false)} onShow={() => setMenuOpen(true)}>
                    {/* overleaf-lab (2026-11, z-order lesson): the history menu
                        must NOT popper-position past the panel right edge — the
                        rail panel's overflow:hidden clips it and the editor shows
                        through. The workbench assistant got the same fix; this
                        copy constrains the menu to the panel width (Bootstrap
                        bottom-end + CSS max-width below). */}
                    <div
                        style={{ display: 'flex', alignItems: 'center', position: 'relative' }}
                        id="review-history-anchor"
                    >
                        <OLTooltip id="review-history" description={t('review_history', 'Conversation history')} overlayProps={{ placement: 'bottom' }}>
                            <OLIconButton
                                className="rail-panel-header-button-subdued"
                                icon="history"
                                size="sm"
                                onClick={() => setMenuOpen(open => !open)}
                            />
                        </OLTooltip>
                        <DropdownMenu
                            ref={menuRef}
                            className="review-history-menu"
                            style={{ maxHeight: '55vh', overflowY: 'auto' }}
                        >
                            <DropdownItem onClick={newConversation}>
                                <MaterialIcon type="add_circle" />
                                {t('review_new_chat', 'New review conversation')}
                            </DropdownItem>
                            {conversations.map(c => (
                                <DropdownItem
                                    key={c.id}
                                    active={c.id === activeConversationId}
                                    onClick={() => switchConversation(c.id)}
                                    style={{ justifyContent: 'space-between', gap: 4 }}
                                >
                                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {c.title}
                                    </span>
                                    <OLIconButton
                                        size="sm"
                                        icon="delete"
                                        unfilled
                                        accessibilityLabel={t('review_delete_chat', 'Delete this conversation')}
                                        onClick={() => deleteConversation(c.id)}
                                    />
                                </DropdownItem>
                            ))}
                            {conversations.length === 0 && (
                                <DropdownItem disabled>
                                    {t('review_no_history', 'No saved conversations yet')}
                                </DropdownItem>
                            )}
                            {activeConversationId && (
                                <>
                                    <hr className="dropdown-divider" />
                                    <DropdownItem onClick={exportConversation}>
                                        <MaterialIcon type="publish" />
                                        {t('review_export', 'Export conversation (Markdown)')}
                                    </DropdownItem>
                                </>
                            )}
                            <hr className="dropdown-divider" />
                            <DropdownItem
                                style={{ color: 'var(--error-color, #dc3545)' }}
                                disabled={conversations.length === 0}
                                onClick={() => clearAllHistory()}
                            >
                                <MaterialIcon type="delete_sweep" />
                                {t('review_clear_all', 'Clear all review conversations…')}
                            </DropdownItem>
                        </DropdownMenu>
                    </div>
                </Dropdown>
                <OLButton variant="secondary" size="sm" onClick={newConversation} title={t('review_new_chat', 'New review conversation')}>
                    <MaterialIcon type="add_circle" />
                </OLButton>
            </div>

            {/* messages */}
            <div
                ref={scrollRef}
                style={{ flex: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8 }}
            >
                {messages
                    .filter(m => m.role !== 'system')
                    .map((m, i) => (
                        <div
                            key={i}
                            style={{
                                padding: '8px 10px',
                                borderRadius: 8,
                                fontSize: '0.9em',
                                whiteSpace: 'pre-wrap',
                                overflowWrap: 'anywhere',
                                background: m.role === 'user'
                                    ? 'color-mix(in srgb, var(--brand-primary) 10%, transparent)'
                                    : 'rgba(125,125,125,0.14)',
                            }}
                        >
                            <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.04em', color: muted, marginBottom: 2 }}>
                                {m.role === 'user' ? t('you', 'You') : t('review', 'Review assistant')}
                            </div>
                            {m.content}
                        </div>
                    ))}
                {isLoading && (
                    <div style={{ padding: '6px 10px', color: muted, fontSize: '0.85em' }}>
                        {t('review_thinking', 'Thinking…')}
                    </div>
                )}
                {error && (
                    <div style={{ padding: 8, borderRadius: 6, color: 'var(--red-60, #dc3545)', background: 'rgba(220,53,69,0.08)' }}>
                        {error}
                    </div>
                )}
            </div>

            {/* composer */}
            <div style={{ display: 'flex', gap: 6 }}>
                <textarea
                    className="form-control"
                    rows={2}
                    placeholder={t('review_question_hint', 'Ask about the review, the rubric, or the document…')}
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={e => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault()
                            submit()
                        }
                    }}
                />
                {isLoading ? (
                    <OLButton variant="secondary" onClick={stopGeneration}>
                        <MaterialIcon type="stop" />
                    </OLButton>
                ) : (
                    <OLButton variant="primary" onClick={submit} disabled={!input.trim()}>
                        <MaterialIcon type="send" />
                    </OLButton>
                )}
            </div>
        </div>
    )
}

export default LLMReviewChat
