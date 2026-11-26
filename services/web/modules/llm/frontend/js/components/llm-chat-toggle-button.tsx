import React, { useState } from 'react'
import classNames from 'classnames'
import { useTranslation } from 'react-i18next'
import MaterialIcon from '@/shared/components/material-icon'
import { useLLMChat } from '../hooks/use-llm-chat'
import LLMChatPane from './llm-chat-pane'

function LLMChatToggleButton() {
    const { t } = useTranslation()
    const { modelsLoaded, modelsError, hasModels } = useLLMChat()
    const [isOpen, setIsOpen] = useState(false)

    // Hide button only when models have been successfully loaded but none are available
    // (explicit server-side "LLM not configured"). Keep visible on errors.
    if (modelsLoaded && !modelsError && !hasModels) {
        return null
    }

    return (
        <>
            <button
                type="button"
                className={classNames('ol-cm-toolbar-button', { active: isOpen })}
                onClick={() => setIsOpen(prev => !prev)}
                title={t('ai_assistant', 'AI Assistant')}
                aria-label={t('ai_assistant', 'AI Assistant')}
            >
                <MaterialIcon type="smart_toy" />
            </button>
            {isOpen && (
                <div
                    style={{
                        position: 'fixed',
                        top: 0,
                        right: 0,
                        bottom: 0,
                        width: 420,
                        zIndex: 100,
                        boxShadow: '-2px 0 12px rgba(0,0,0,0.15)',
                    }}
                >
                    <LLMChatPane isOpen={isOpen} onClose={() => setIsOpen(false)} />
                </div>
            )}
        </>
    )
}

export default LLMChatToggleButton
