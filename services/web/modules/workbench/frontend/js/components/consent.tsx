/**
 * Displays the AI consent prompt and saves acceptance through useAiConsent.
 * Reuses the shared consent text and displays errors if saving fails.
 */
import { useTranslation } from 'react-i18next'
import OLButton from '@/shared/components/ol/ol-button'
import OLNotification from '@/shared/components/notification'
import useAiConsent from '@/shared/hooks/use-ai-consent'
import {
  AiConsentPromptMessageHeader,
  AiConsentPromptMessageBody,
} from '@/shared/components/ai-consent-prompt-message'

export default function WorkbenchConsent() {
  const { t } = useTranslation()
  const { giveAiConsent, consentError } = useAiConsent()
  return (
    <div className="workbench-consent-wrapper">
      {consentError && (
        <OLNotification
          type="error"
          content={t('failed_to_consent_to_workbench_terms')}
        />
      )}
      <div
        className="workbench-consent-prompt"
        role="region"
        aria-label={t('give-ai-consent')}
      >
        <AiConsentPromptMessageHeader className="workbench-consent-prompt-header" />
        <AiConsentPromptMessageBody className="workbench-consent-prompt-body" />
        <div className="workbench-consent-prompt-footer">
          <OLButton variant="primary" onClick={giveAiConsent}>
            {t('accept_and_continue')}
          </OLButton>
        </div>
      </div>
    </div>
  )
}
