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
import React from 'react'
import { useTranslation } from 'react-i18next'
import RailPanelHeader from '@/features/ide-react/components/rail/rail-panel-header'
import LLMCompliancePane from './llm-compliance-pane'
import { RailElement } from '@/features/ide-react/util/rail-types'
import getMeta from '@/utils/meta'
import { useLLMFeatures } from '../hooks/use-llm-features'
import '../../stylesheets/llm-ui.scss'

function LLMPane() {
    const { t } = useTranslation()
    const features = useLLMFeatures()
    const reviewVisible = features.reviewEnabled

    return (
        <div className="llm-rail-pane">
            <RailPanelHeader title={t('ai_check', 'AI check')} />
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
                <div
                    style={{
                        display: 'flex',
                        flexDirection: 'column',
                        flex: 1,
                        minHeight: 0,
                        overflow: 'hidden',
                    }}
                >
                    <LLMCompliancePane />
                </div>
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
