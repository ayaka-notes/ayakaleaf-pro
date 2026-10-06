/**
 * Displays chat errors from a message or structured notification.
 * Uses a generic error notice when no details are supplied.
 */
import { useTranslation } from 'react-i18next'
import OLNotification from '@/shared/components/notification'

export type WorkbenchError =
  | string
  | { title?: string; message?: string; type?: string }
  | boolean

export default function WorkbenchErrorNotification({
  content,
}: {
  content: WorkbenchError
}) {
  const { t } = useTranslation()
  switch (typeof content) {
    case 'string':
      return (
        <OLNotification
          title={t('error')}
          content={content}
          type="error"
          className="workbench-error-notification"
          isDismissible
        />
      )
    case 'object':
      return (
        <OLNotification
          title={content.title}
          content={content.message}
          type={(content.type as any) || 'error'}
          className="workbench-error-notification"
          isDismissible
        />
      )
    default:
      return (
        <OLNotification
          title={t('somethings_gone_wrong')}
          content={t('weve_hit_a_problem_try_starting_a_new_chat')}
          type="error"
          className="workbench-error-notification"
          isDismissible
        />
      )
  }
}
