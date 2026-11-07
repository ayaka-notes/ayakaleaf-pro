/**
 * Notices shown in the chat: errors, the quota running out, and AI being
 * turned off for this project.
 */
import { useTranslation } from 'react-i18next'
import OLNotification from '@/shared/components/notification'
import { formatSecondsToHoursAndMinutes } from '@/shared/utils/time'

export function ChatNotice({
  type,
  title,
  text,
}: {
  type: 'error' | 'info' | 'warning'
  title?: string
  text?: string
}) {
  return (
    <OLNotification
      type={type}
      title={title}
      content={text}
      className="my-2"
      isDismissible={type === 'error'}
    />
  )
}

/** The generic error, with the text the core uses for chats. */
export function ChatFailedNotice() {
  const { t } = useTranslation()
  return (
    <ChatNotice
      type="error"
      title={t('somethings_gone_wrong')}
      text={t('weve_hit_a_problem_try_starting_a_new_chat')}
    />
  )
}

export function QuotaNotice({ resetsAt }: { resetsAt: Date }) {
  const { t } = useTranslation()
  const seconds = Math.max(0, (resetsAt.getTime() - Date.now()) / 1000)
  return (
    <ChatNotice
      type="info"
      title={t('usage_limit_reached')}
      text={t(
        'youve_reached_the_fair_usage_limit_on_your_plan_you_can_start_chatting_again_in_time',
        { time: formatSecondsToHoursAndMinutes(t, seconds) }
      )}
    />
  )
}

export function AiOffNotice() {
  const { t } = useTranslation()
  return (
    <ChatNotice
      type="info"
      title={t('ai_assistant_disabled')}
      text={t('ai_features_unavailable_on_this_project')}
    />
  )
}
