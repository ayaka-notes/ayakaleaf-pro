// LLM section on the Account Settings page.
//
// The inline BYO provider table used to render here. It is now a single LINK
// to the dedicated /user/llm-settings page (BYO providers + the user's own
// compliance review rubrics), keeping the Account Settings page lean. The
// module import was dropped with the table — the page itself loads the
// module's React code.
import React from 'react'
import { useTranslation } from 'react-i18next'

function LLMUserSection() {
    const { t } = useTranslation()

    return (
        <div style={{ marginTop: '0.5rem' }}>
            <h2>{t('llm_section_title', 'AI assistant')}</h2>
            <p style={{ color: '#6c757d' }}>
                {t(
                    'llm_section_help',
                    'Manage your LLM connections, your selected model and your compliance review rubrics. API keys are encrypted on this server.',
                )}
            </p>
            <a
                href="/user/llm-settings"
                className="btn btn-secondary"
                aria-label={t('llm_section_open', 'Open AI settings')}
                style={{ marginTop: '0.5rem' }}
            >
                {t('llm_section_open', 'Open AI settings')}
            </a>
        </div>
    )
}

export default LLMUserSection
