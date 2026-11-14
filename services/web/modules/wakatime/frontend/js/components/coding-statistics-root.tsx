import { useTranslation } from 'react-i18next'
import OLRow from '@/shared/components/ol/ol-row'
import OLCol from '@/shared/components/ol/ol-col'
import OLPageContentCard from '@/shared/components/ol/ol-page-content-card'
import { WakaTimeWidget } from './wakatime-widget'
import WakaTimeStatsSection from './wakatime-stats-section'

/**
 * Dedicated in-Overleaf "Coding statistics" page (GET /user/coding-statistics).
 *
 * Shows the logged-in user's own tracked time via the WakaTime/Wakapi API —
 * no separate login for the stats themselves. The user links their
 * wakatime.com account (OAuth or API key) once, in the connect widget below.
 */

function readQueryFlag(name: string): string | null {
  try {
    return new URLSearchParams(window.location.search).get(name)
  } catch {
    return null
  }
}

export default function CodingStatisticsRoot() {
  const { t } = useTranslation()
  const linkedFlag = readQueryFlag('waka_linked')
  const errorFlag = readQueryFlag('waka_error')

  const errorText =
    errorFlag === 'state_mismatch'
      ? t('wakatime_oauth_state_mismatch', {
          defaultValue:
            'The WakaTime connection could not be completed (mismatched security token). Please try again.',
        })
      : errorFlag === 'not_configured'
        ? t('wakatime_not_configured', {
            defaultValue:
              'WakaTime.com connection is not configured on this deployment. Ask your administrator or use an API key instead.',
          })
        : t('wakatime_oauth_failed', {
            defaultValue:
              'Connecting to WakaTime.com failed. Please try again, or link with an API key instead.',
          })

  return (
    <div className="container coding-statistics-page">
      <OLRow>
        <OLCol xl={{ span: 10, offset: 1 }}>
          <OLPageContentCard>
            <div className="page-header">
              <h1>
                {t('coding_statistics', { defaultValue: 'Coding statistics' })}
              </h1>
            </div>
            <div>
              {linkedFlag ? (
                <div className="coding-statistics-notice notice-success">
                  {t('wakatime_linked_success', {
                    defaultValue:
                      'WakaTime account linked. Your statistics will appear below.',
                  })}
                </div>
              ) : null}
              {errorFlag ? (
                <div className="coding-statistics-notice notice-error">
                  {errorText}
                </div>
              ) : null}

              <WakaTimeWidget />
              <hr />
              <WakaTimeStatsSection />
            </div>
          </OLPageContentCard>
        </OLCol>
      </OLRow>
    </div>
  )
}
