import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import RailPanelHeader from '@/features/ide-react/components/rail/rail-panel-header'
import LLMChatPane from './llm-chat-pane'
import LLMCompliancePane from './llm-compliance-pane'
import { RailElement } from '@/features/ide-react/util/rail-types'
import getMeta from '@/utils/meta'
import { useLLMFeatures } from '../hooks/use-llm-features'
import '../../stylesheets/llm-ui.scss'

function LLMRailPane() {
    const { t } = useTranslation()
    const rootRef = React.useRef<HTMLDivElement>(null)

    // overleaf-lab (2026-11, owner report "chat stuck light, dark broken"): the
    // rail panel is an APP-THEME surface — the editor-theme bridge is
    // deliberately NOT applied here (it was pinning the panel to the editor's
    // light pair inside a dark app). Editor-themed surfaces = the selection
    // toolbar overlay inside the editor (llm-toolbar.tsx keeps the watcher).

    // overleaf-lab: switch between the chat assistant and the whole-document
    // compliance review inside the same rail panel.
    const [tab, setTab] = useState<'chat' | 'review'>('chat')

    // overleaf-lab: super-admin feature flags decide which tabs exist. Chat maps
    // to the chat pane, review to the compliance pane. Until the flags load both
    // default to visible (fail open) so nothing flickers off then on.
    const features = useLLMFeatures()
    const chatVisible = features.chatEnabled
    const reviewVisible = features.reviewEnabled

    // overleaf-lab: never leave the active tab pointing at a hidden pane. Once the
    // flags are loaded, fall back to whichever tab is still visible.
    useEffect(() => {
        if (!features.loaded) return
        if (tab === 'chat' && !chatVisible && reviewVisible) {
            setTab('review')
        } else if (tab === 'review' && !reviewVisible && chatVisible) {
            setTab('chat')
        }
    }, [features.loaded, chatVisible, reviewVisible, tab])

    const tabButtonStyle = (active: boolean): React.CSSProperties => ({
        appearance: 'none',
        background: 'none',
        border: 'none',
        padding: '6px 12px',
        cursor: 'pointer',
        // overleaf-lab: inherit the panel's themed text color for BOTH tabs (same
        // color as the "AI Assistant" header, so legible on light and dark), and
        // distinguish the active one with weight + an accent underline, the inactive
        // one with reduced opacity. Using inherit avoids depending on a token that
        // did not flip on dark (--content-primary read dark-on-dark before).
        color: 'inherit',
        opacity: active ? 1 : 0.6,
        fontWeight: active ? 600 : 400,
        borderBottom: active
            ? '2px solid var(--wf-accent, var(--bg-accent-01, #3265b5))'
            : '2px solid transparent',
    })

    return (
        <div className="llm-rail-panel" ref={rootRef}>
            <RailPanelHeader title={t('ai_assistant', 'AI Assistant')} />

            {features.loaded && !chatVisible && !reviewVisible ? (
                // overleaf-lab: the admin disabled every AI feature for this
                // project, so there is nothing to show.
                <div
                    style={{
                        padding: '12px',
                        color: 'var(--content-secondary, inherit)',
                        opacity: 0.7,
                        fontSize: 13,
                    }}
                >
                    {t(
                        'llm_all_features_disabled',
                        'AI features are currently disabled by the administrator.'
                    )}
                </div>
            ) : (
                <>
                    {/* overleaf-lab: only show the two-tab bar when BOTH panes are
                        available; with a single feature the tab bar is redundant. */}
                    {chatVisible && reviewVisible && (
                        <div
                            style={{
                                display: 'flex',
                                gap: 4,
                                borderBottom: '1px solid var(--border-divider, rgba(125,125,125,0.2))',
                            }}
                            role="tablist"
                        >
                            <button
                                type="button"
                                role="tab"
                                aria-selected={tab === 'chat'}
                                style={tabButtonStyle(tab === 'chat')}
                                onClick={() => setTab('chat')}
                            >
                                {t('chat', 'Chat')}
                            </button>
                            <button
                                type="button"
                                role="tab"
                                aria-selected={tab === 'review'}
                                style={tabButtonStyle(tab === 'review')}
                                onClick={() => setTab('review')}
                            >
                                {t('review', 'Review')}
                            </button>
                        </div>
                    )}

                    {/* overleaf-lab: when both panes are enabled keep BOTH mounted
                        and toggle visibility, so a running review (and its
                        polling/queue state) survives a tab switch. With a single
                        feature only that pane is mounted, always shown. */}
                    {chatVisible && (
                        <div
                            style={{
                                display: reviewVisible
                                    ? tab === 'chat'
                                        ? 'flex'
                                        : 'none'
                                    : 'flex',
                                flexDirection: 'column',
                                flex: 1,
                                minHeight: 0,
                                overflow: 'hidden',
                            }}
                        >
                            <LLMChatPane />
                        </div>
                    )}
                    {reviewVisible && (
                        <div
                            style={{
                                display: chatVisible
                                    ? tab === 'review'
                                        ? 'flex'
                                        : 'none'
                                    : 'flex',
                                flexDirection: 'column',
                                flex: 1,
                                minHeight: 0,
                                overflow: 'hidden',
                            }}
                        >
                            <LLMCompliancePane />
                        </div>
                    )}
                </>
            )}
        </div>
    )
}

const llmRailEntry: RailElement = {
    key: 'llm-chat',
    icon: 'smart_toy',
    title: 'AI Assistant',
    component: <LLMRailPane />,
    hide: () => !(getMeta('ol-ExposedSettings') as any)?.llmEnabled,
}

export default llmRailEntry
