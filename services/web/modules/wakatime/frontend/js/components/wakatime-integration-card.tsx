import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useProjectContext } from '@/shared/context/project-context'
import { getJSON } from '@/infrastructure/fetch-json'
import { debugConsole } from '@/utils/debugging'
import WakaTimeLogo from '@/shared/svgs/wakatime-logo'
import IntegrationCard from '@/features/integrations-panel/integration-card'
import WakaTimeConnectModal from './wakatime-connect-modal'

type SummaryResponse =
  | { connected: false }
  | { connected: true; totalSeconds: number; rangeDays: number }

function formatDuration(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  if (hours === 0 && minutes === 0) return '0m'
  if (hours === 0) return `${minutes}m`
  return `${hours}h ${minutes}m`
}

function WakaTimeCard() {
  const { t } = useTranslation()
  const { project } = useProjectContext()
  const projectId = project?._id

  const [summary, setSummary] = useState<SummaryResponse | null>(null)
  const [showConnectModal, setShowConnectModal] = useState(false)

  const loadSummary = () => {
    if (!projectId) return
    getJSON<SummaryResponse>(`/project/${projectId}/wakatime/summary`)
      .then(setSummary)
      .catch(err => debugConsole.error(err?.data?.message || err?.message || err))
  }

  useEffect(loadSummary, [projectId])

  if (!projectId) return null

  const isConnected = summary?.connected === true

  const description = summary?.connected
    ? t('wakatime_time_this_week', {
        defaultValue: '__duration__ tracked (last __days__ days)',
        duration: formatDuration(summary.totalSeconds),
        days: summary.rangeDays,
      })
    : t('wakatime_connect_to_track_time', {
        defaultValue: 'Connect WakaTime to track time on this project',
      })

  return (
    <>
      <IntegrationCard
        title="WakaTime"
        description={description}
        icon={<WakaTimeLogo size={32} />}
        showPaywallBadge={false}
        onClick={
          isConnected
            ? undefined
            : () => setShowConnectModal(true)
        }
        href={
          isConnected
            ? '/user/settings#project-sync'
            : undefined
        }
      />

      <WakaTimeConnectModal
        show={showConnectModal}
        handleHide={() => setShowConnectModal(false)}
        onLinked={loadSummary}
      />
    </>
  )
}

export default WakaTimeCard
