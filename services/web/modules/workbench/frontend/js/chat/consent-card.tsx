/**
 * Asks for the AI terms once, with the core's consent text and hook.
 */
import { useTranslation } from 'react-i18next'
import OLButton from '@/shared/components/ol/ol-button'
import useAiConsent from '@/shared/hooks/use-ai-consent'
import {
  AiConsentPromptMessageHeader,
  AiConsentPromptMessageBody,
} from '@/shared/components/ai-consent-prompt-message'
import { ChatNotice } from './notices'
import { useNoticeColors } from './themed'

export default function ConsentCard() {
  const { t } = useTranslation()
  const { giveAiConsent, consentError } = useAiConsent()
  const notice = useNoticeColors()
  return (
    <div className="d-flex flex-column justify-content-end flex-grow-1">
      {consentError && (
        <ChatNotice type="error" text={t('failed_to_consent_to_workbench_terms')} />
      )}
      <section
        className="rounded p-3 d-flex flex-column gap-3"
        style={notice}
        aria-label={t('give-ai-consent')}
      >
        <AiConsentPromptMessageHeader className="d-flex align-items-center gap-2 fw-bold" />
        <AiConsentPromptMessageBody className="d-flex flex-column gap-2" />
        <OLButton variant="primary" className="align-self-end" onClick={giveAiConsent}>
          {t('accept_and_continue')}
        </OLButton>
      </section>
    </div>
  )
}
