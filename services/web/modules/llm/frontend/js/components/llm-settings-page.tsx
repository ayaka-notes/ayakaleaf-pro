import React from 'react'
import { useTranslation } from 'react-i18next'
import getMeta from '@/utils/meta'
import LLMSettingsSection from './llm-settings-section'
import LLMEditorSettings from './llm-editor-settings' // overleaf-lab: per-user editor prefs
import LLMComplianceSettings from './llm-compliance-settings' // overleaf-lab: user-scoped review rubrics
import LLMUsageMeter from './llm-usage-meter' // overleaf-lab (usage meter)
import OLRow from '@/shared/components/ol/ol-row'
import OLCol from '@/shared/components/ol/ol-col'
import OLPageContentCard from '@/shared/components/ol/ol-page-content-card'
import { UserProvider } from '@/shared/context/user-context'
import useWaitForI18n from '@/shared/hooks/use-wait-for-i18n'
import useScrollToIdOnLoad from '@/shared/hooks/use-scroll-to-id-on-load'
import MaterialIcon from '@/shared/components/material-icon'
// overleaf-lab: BYO table/editor styles were only imported by the admin page,
// so this page shipped with zero module CSS — import the shared stylesheet here too.
import '../../stylesheets/llm-settings.scss'
// overleaf-lab: shared upstream-AI design tokens (--wf-*) used by the settings chrome
import '../../stylesheets/llm-ui.scss'

// overleaf-lab (2026-11, owner request): the user-facing page used the same
// section chrome as /admin/llm/settings (badge + title + description + border
// body) instead of bare h2 headings, so both look like one product surface.
function SettingsBlock({
    num,
    icon,
    title,
    desc,
    children,
}: {
    num: string
    icon?: string
    title: string
    desc: string
    children?: React.ReactNode
}) {
    return (
        <div className="llm-settings-section">
            <div className="llm-settings-section-header">
                <span className="llm-settings-section-badge">{icon ? <MaterialIcon type={icon} style={{ fontSize: 14 }} /> : num}</span>
                {title}
            </div>
            <p className="llm-settings-section-desc">{desc}</p>
            <div className="llm-settings-section-body">
                <div style={{ padding: 16 }}>{children}</div>
            </div>
        </div>
    )
}

export default function LLMSettingsPage() {
    const { t } = useTranslation()
    const { isReady } = useWaitForI18n()
    useScrollToIdOnLoad()
    const user = getMeta('ol-user') || {}

    return (
        <div className="container">
            <OLRow>
                <OLCol xl={{ span: 10, offset: 1 }}>
                    {isReady ? (
                        <UserProvider>
                            <OLPageContentCard>
                                <div className="page-header">
                                    <h1>{t('llm_settings', 'LLM Settings')}</h1>
                                </div>
                                {/* overleaf-lab (2026-11, owner request): editor-scoped
                                    preferences come first — the inline-completion
                                    toggle is per user and always available. */}
                                <SettingsBlock
                                    num="1"
                                    title={t('editor', 'Editor')}
                                    desc={t(
                                        'user_settings_editor_desc',
                                        'How AI behaves in your editor: inline completion and your per-task model choices.'
                                    )}
                                >
                                    <LLMEditorSettings />
                                </SettingsBlock>
                                <SettingsBlock
                                    num="2"
                                    title={t('ai_connections', 'Connections & models')}
                                    desc={t(
                                        'user_settings_connections_desc',
                                        'Your own provider connections (bring your own key) and the model each task uses. Leave empty to use the institution connection.'
                                    )}
                                >
                                    <LLMSettingsSection initialSettings={user.llmSettings} />
                                </SettingsBlock>
                                {/* overleaf-lab (2026-08-27, owner request): the compliance
                                    review rubrics are USER-SCOPED and configured here, in
                                    every user's own LLM settings — the former global admin
                                    section is gone. */}
                                <SettingsBlock
                                    num="3"
                                    title={t('compliance_review', 'Compliance Review')}
                                    desc={t(
                                        'user_settings_review_desc',
                                        'The guidelines the AI check runs against your documents. These rubrics are yours, per account.'
                                    )}
                                >
                                    <LLMComplianceSettings />
                                </SettingsBlock>
                                {/* overleaf-lab (usage meter, 2026-08-28, owner request): my own token
                                    usage — both the site lane and my personal BYO rows count.
                                    overleaf-lab (merge phase 3): the AI assistant's usage
                                    now lands in this same ledger too. */}
                                <SettingsBlock
                                    num="4"
                                    title={t('llm_usage', 'Usage')}
                                    desc={t(
                                        'user_settings_usage_desc',
                                        'Your token usage across chat, the AI assistant, completion and reviews — site and personal connections.'
                                    )}
                                >
                                    <LLMUsageMeter scope="user" />
                                </SettingsBlock>
                            </OLPageContentCard>
                        </UserProvider>
                    ) : null}
                </OLCol>
            </OLRow>
        </div>
    )
}
