/**
 * Displays the AI-unavailable notice when ol-showAiFeaturesDisabled is set.
 */
import { useTranslation } from 'react-i18next'
import OLNotification from '@/shared/components/notification'

export default function AiAssistantDisabled() {
  const { t } = useTranslation()
  return (
    <OLNotification
      type="info"
      customIcon={null}
      title={t('ai_assistant_disabled')}
      content={t('ai_features_unavailable_on_this_project')}
      isDismissible={false}
    />
  )
}
