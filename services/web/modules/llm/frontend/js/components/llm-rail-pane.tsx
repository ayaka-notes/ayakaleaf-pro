// overleaf-lab (2026-11, merge phase 2 + 5): the llm module's rail pane used to
// host TWO tabs — Chat (LLMChatPane) and Review (LLMCompliancePane). The two
// assistants were unified: CHAT is now the workbench AI assistant (it gained
// the shared BYO provider bridge, the per-project chat history from issue #119,
// and browser tools). This rail entry is the REVIEW surface only, so the owner
// sees exactly one assistant tab + one review tab.
//
// port-or-keep decision (phase 5), kept in one place:
//   chat / assistant + history  → workbench (this branch's unified assistant)
//   compliance review           → llm module (this pane; per-project rubrics)
//   inline completion           → llm module (editor extension, Tab-accept)
//   apply-fix / compile-fix     → llm module (editors + PDF log integration)
//   ask-AI selection actions    → llm module (selection toolbar)
// shared by all: lane resolution (per-task model selection), admin kill
// switches (llmDisabledByAdmin + per-feature flags), per-user budget, and the
// single usage ledger (LLMUsage).
import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import MaterialIcon from '@/shared/components/material-icon'
import RailPanelHeader from '@/features/ide-react/components/rail/rail-panel-header'
import LLMCompliancePane from './llm-compliance-pane'
import LLMReviewChat from './llm-review-chat'
import { RailElement } from '@/features/ide-react/util/rail-types'
import getMeta from '@/utils/meta'
import { useLLMFeatures } from '../hooks/use-llm-features'
import '../../stylesheets/llm-ui.scss'

function LLMPane() {
    const { t } = useTranslation()
    const features = useLLMFeatures()
    const reviewVisible = features.reviewEnabled
    // overleaf-lab (2026-11, owner request): the review pane now has TWO
    // surfaces — Check (the rubric run, unchanged) and Chat (its OWN
    // conversation + history, on the 'review' task lane). Both stay MOUNTED
    // (hidden via CSS) so switching tabs never drops the chat state or timer.
    const [tab, setTab] = useState<'check' | 'chat'>('check')

    const tabButton = (key: 'check' | 'chat', label: string, icon: string): React.ReactElement => (
        <button
            type="button"
            key={key}
            onClick={() => setTab(key)}
            aria-pressed={tab === key}
            style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                padding: '8px 4px',
                border: 'none',
                cursor: 'pointer',
                fontSize: 13,
                background: tab === key
                    ? 'var(--brand-primary, #0d6efd)'
                    : 'transparent',
                color: tab === key
                    ? 'var(--white, #fff)'
                    : 'var(--content-primary-themed)',
                borderRadius: 6,
            }}
        >
            <MaterialIcon type={icon} fontSize={16} />
            {label}
        </button>
    )

    return (
        <div className="llm-rail-pane" style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <RailPanelHeader title={t('ai_check', 'AI check')} />
            <div
                style={{
                    display: 'flex',
                    gap: 4,
                    padding: '8px 12px 0',
                }}
            >
                {tabButton('check', t('review_tab_check', 'Check'), 'fact_check')}
                {tabButton('chat', t('review_tab_chat', 'Chat'), 'chat')}
            </div>
            {features.loaded && !reviewVisible ? (
                // overleaf-lab: the admin disabled compliance review for this
                // project, so there is nothing to show here. (Chat has its own
                // home: the AI assistant in the workbench.)
                <div
                    style={{
                        padding: '12px',
                        color: 'var(--content-secondary, inherit)',
                        opacity: 0.7,
                        fontSize: 13,
                    }}
                >
                    {t(
                        'llm_review_disabled',
                        'The AI check feature is currently disabled by the administrator.'
                    )}
                </div>
            ) : (
                <>
                    <div
                        style={{
                            display: tab === 'check'
                                ? 'flex'
                                : 'none',
                            flexDirection: 'column',
                            flex: 1,
                            minHeight: 0,
                            overflow: 'hidden',
                        }}
                    >
                        <LLMCompliancePane />
                    </div>
                    <div
                        style={{
                            display: tab === 'chat'
                                ? 'flex'
                                : 'none',
                            flexDirection: 'column',
                            flex: 1,
                            minHeight: 0,
                            overflow: 'hidden',
                        }}
                    >
                        <LLMReviewChat />
                    </div>
                </>
            )}
        </div>
    )
}

const llmRailEntry: RailElement = {
    key: 'llm-chat',
    icon: 'smart_toy',
    title: 'AI check',
    component: <LLMPane />,
    hide: () => !(getMeta('ol-ExposedSettings') as any)?.llmEnabled,
}

export default llmRailEntry
