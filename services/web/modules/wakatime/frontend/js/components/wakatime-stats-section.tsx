import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getJSON } from '@/infrastructure/fetch-json'
import OLFormSelect from '@/shared/components/ol/ol-form-select'
import WakaTimeLogo from '@/shared/svgs/wakatime-logo'
import getMeta from '@/utils/meta'
import { debugConsole } from '@/utils/debugging'

/**
 * "Coding statistics" dashboard (dedicated page /user/coding-statistics).
 *
 * Mirrors the information layout of the WakaTime dashboard (overview
 * numbers, daily activity, top languages, top projects) in Overleaf's
 * own visual language — flat cards, plain bars, no WakaTime chrome.
 *
 * Data comes from the user-scoped endpoint (GET /user/wakatime/summary),
 * so each user only ever sees their own statistics.
 */

type WakaTimeSummary = {
  connected: boolean
  totalSeconds?: number
  rangeDays?: number
  activeDays?: number
  dailyAverageSeconds?: number
  days?: { date: string; seconds: number; languages?: { name: string; seconds: number }[] }[]
  projects?: { name: string; seconds: number }[]
  languages?: { name: string; seconds: number }[]
  editors?: { name: string; seconds: number }[]
  operatingSystems?: { name: string; seconds: number }[]
}

// Muted, distinct palette for the daily chart language segments
const CHART_COLORS = [
  '#4c7fbb',
  '#e8974c',
  '#5ba584',
  '#a06cc4',
  '#d46a8a',
  '#8d99ae',
  '#c9a227',
]

function formatDuration(totalSeconds: number): string {
  if (!totalSeconds) return '0m'
  const days = Math.floor(totalSeconds / 86400)
  const hours = Math.floor((totalSeconds % 86400) / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

function formatDayLabel(dateStr: string): string {
  // 2026-11-14 -> "Nov 14" (local, for axis labels)
  const d = new Date(`${dateStr}T12:00:00`)
  if (isNaN(d.getTime())) return dateStr
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/** Overview number tile (Total time, Daily average, ...) */
function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="cs-tile">
      <div className="cs-tile-value">{value}</div>
      <div className="cs-tile-label">{label}</div>
      {hint ? <div className="cs-tile-hint">{hint}</div> : null}
    </div>
  )
}

/** Horizontal share bar (Top languages / Top projects) */
function ShareBar({
  name,
  seconds,
  totalSeconds,
  color,
}: {
  name: string
  seconds: number
  totalSeconds: number
  color: string
}) {
  const pct = totalSeconds > 0 ? Math.max((seconds / totalSeconds) * 100, 1.5) : 0
  return (
    <div className="cs-share-row">
      <div className="cs-share-head">
        <span className="cs-share-name" title={name}>
          {name}
        </span>
        <span className="cs-share-value">
          {formatDuration(seconds)}
          {totalSeconds > 0 ? (
            <span className="cs-share-pct"> · {Math.round((seconds / totalSeconds) * 100)}%</span>
          ) : null}
        </span>
      </div>
      <div className="cs-share-track">
        <div className="cs-share-fill" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
    </div>
  )
}

/** Daily activity chart: one stacked column per day (top languages) */
function DailyChart({
  days,
  languages,
}: {
  days: { date: string; seconds: number; languages?: { name: string; seconds: number }[] }[]
  languages: { name: string; seconds: number }[]
}) {
  const maxDay = Math.max(...days.map(d => d.seconds), 1)
  const nameToColor = new Map<string, string>()
  languages.forEach((l, i) => nameToColor.set(l.name, CHART_COLORS[i % CHART_COLORS.length]))

  // Label every Nth day so 7–90 columns stay readable
  const labelEvery = Math.max(1, Math.ceil(days.length / 10))

  return (
    <div className="cs-chart">
      <div className="cs-chart-cols">
        {days.map((day, i) => {
          const segments = (day.languages || []).map((l, j) => ({
            ...l,
            color: nameToColor.get(l.name) || CHART_COLORS[(j + 2) % CHART_COLORS.length],
          }))
          const tooltip = [
            `${day.date} — ${formatDuration(day.seconds)}`,
            ...(day.languages || []).map(l => `  ${l.name}: ${formatDuration(l.seconds)}`),
          ].join('\n')
          return (
            <div key={day.date} className="cs-chart-col" title={tooltip}>
              <div className="cs-chart-bar-area">
                <div
                  className="cs-chart-stack"
                  style={{ height: `${(day.seconds / maxDay) * 100}%` }}
                >
                  {segments.map(seg => (
                    <div
                      key={seg.name}
                      className="cs-chart-seg"
                      style={{
                        height: `${day.seconds > 0 ? (seg.seconds / day.seconds) * 100 : 0}%`,
                        backgroundColor: seg.color,
                      }}
                    />
                  ))}
                </div>
              </div>
              <div className="cs-chart-label">{i % labelEvery === 0 ? formatDayLabel(day.date) : ''}</div>
            </div>
          )
        })}
      </div>
      {languages.length > 0 ? (
        <div className="cs-chart-legend">
          {languages.slice(0, 6).map((l, i) => (
            <span key={l.name} className="cs-chart-legend-item" title={l.name}>
              <span
                className="cs-chart-legend-swatch"
                style={{ backgroundColor: CHART_COLORS[i % CHART_COLORS.length] }}
              />
              {l.name}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export default function WakaTimeStatsSection() {
  const { t } = useTranslation()
  const enabled = getMeta('ol-ExposedSettings')?.wakaTimeEnabled
  const [rangeDays, setRangeDays] = useState(30)
  const [summary, setSummary] = useState<WakaTimeSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    setError(false)
    getJSON<WakaTimeSummary>(`/user/wakatime/summary?range=${rangeDays}`)
      .then(res => setSummary(res))
      .catch(err => {
        setError(true)
        debugConsole.error('failed to load coding statistics', err?.message || err)
      })
      .finally(() => setLoading(false))
  }, [rangeDays])

  useEffect(() => {
    if (enabled !== false) load()
  }, [load, enabled])

  if (enabled === false) return null

  if (loading && !summary) {
    return (
      <section id="coding-statistics" className="coding-statistics-section">
        <h3>
          <span className="coding-statistics-title-logo">
            <WakaTimeLogo size={20} />
          </span>
          {t('coding_statistics', { defaultValue: 'Coding statistics' })}
        </h3>
        <p className="small">
          {t('loading')}…
        </p>
      </section>
    )
  }

  if (error) {
    return (
      <section id="coding-statistics" className="coding-statistics-section">
        <h3>
          <span className="coding-statistics-title-logo">
            <WakaTimeLogo size={20} />
          </span>
          {t('coding_statistics', { defaultValue: 'Coding statistics' })}
        </h3>
        <p className="small">{t('generic_something_went_wrong')}</p>
      </section>
    )
  }

  if (!summary?.connected) {
    return (
      <section id="coding-statistics" className="coding-statistics-section">
        <h3>
          <span className="coding-statistics-title-logo">
            <WakaTimeLogo size={20} />
          </span>
          {t('coding_statistics', { defaultValue: 'Coding statistics' })}
        </h3>
        <p className="small">
          {t('coding_statistics_not_connected', {
            defaultValue:
              'No coding statistics are available yet. Connect a WakaTime account above — your time in Overleaf starts showing up here right away.',
          })}
        </p>
      </section>
    )
  }

  const totalSeconds = summary.totalSeconds || 0
  const days = summary.days || []
  const languages = summary.languages || []
  const projects = summary.projects || []
  const editors = summary.editors || []
  const operatingSystems = summary.operatingSystems || []

  const topLanguage = languages[0]?.name
  const editorsLine = [...editors, ...operatingSystems]
    .map(x => x.name)
    .filter(n => n && n.toLowerCase() !== 'unknown')
    .slice(0, 3)
    .join(' · ')

  return (
    <section id="coding-statistics" className="coding-statistics-section">
      <div className="cs-header">
        <h3>
          <span className="coding-statistics-title-logo">
            <WakaTimeLogo size={20} />
          </span>
          {t('coding_statistics', { defaultValue: 'Coding statistics' })}
        </h3>
        <OLFormSelect
          className="cs-range-select"
          aria-label={t('time_range', { defaultValue: 'Time range' })}
          value={String(rangeDays)}
          onChange={e => setRangeDays(parseInt(e.target.value, 10))}
        >
          <option value="7">
            {t('last_7_days', { defaultValue: 'Last 7 days' })}
          </option>
          <option value="30">
            {t('last_30_days', { defaultValue: 'Last 30 days' })}
          </option>
          <option value="90">
            {t('last_90_days', { defaultValue: 'Last 90 days' })}
          </option>
        </OLFormSelect>
      </div>

      <p className="small">
        {t(
          'coding_statistics_description',
          {
            defaultValue:
              'Your tracked time in Overleaf (last __days__ days). Only you can see your own statistics.',
            days: rangeDays,
          }
        )}
      </p>

      {/* Overview numbers — like the WakaTime dashboard header cards */}
      <div className="cs-tiles">
        <StatTile
          label={t('total_time', { defaultValue: 'Total time' })}
          value={formatDuration(totalSeconds)}
        />
        <StatTile
          label={t('daily_average', { defaultValue: 'Daily average' })}
          value={formatDuration(summary.dailyAverageSeconds || 0)}
          hint={t('on_active_days', { defaultValue: 'on active days' })}
        />
        <StatTile
          label={t('active_days', { defaultValue: 'Active days' })}
          value={`${summary.activeDays || 0} / ${days.length}`}
        />
        <StatTile
          label={t('top_language', { defaultValue: 'Top language' })}
          value={topLanguage || '—'}
          hint={
            languages.length > 1
              ? t('x_more_languages', {
                  defaultValue: `+${languages.length - 1} more`,
                })
              : undefined
          }
        />
      </div>

      {/* Daily activity — like the WakaTime "Coding activity" chart */}
      <div className="cs-block">
        <h4 className="cs-block-title">
          {t('daily_activity', { defaultValue: 'Daily activity' })}
        </h4>
        {days.length > 0 && totalSeconds > 0 ? (
          <DailyChart days={days} languages={languages} />
        ) : (
          <p className="small text-muted">
            {t('no_activity_yet', {
              defaultValue: 'No coding activity in this period yet.',
            })}
          </p>
        )}
      </div>

      <div className="cs-two-col">
        {/* Top languages — like the WakaTime languages pie */}
        <div className="cs-block">
          <h4 className="cs-block-title">
            {t('languages', { defaultValue: 'Languages' })}
          </h4>
          {languages.length ? (
            <div className="cs-share-list">
              {languages.slice(0, 8).map((item, i) => (
                <ShareBar
                  key={item.name}
                  name={item.name}
                  seconds={item.seconds}
                  totalSeconds={totalSeconds}
                  color={CHART_COLORS[i % CHART_COLORS.length]}
                />
              ))}
            </div>
          ) : (
            <p className="small text-muted">
              {t('no_data_yet', { defaultValue: 'No data yet.' })}
            </p>
          )}
        </div>

        {/* Top projects — like the WakaTime projects section */}
        <div className="cs-block">
          <h4 className="cs-block-title">
            {t('projects', { defaultValue: 'Projects' })}
          </h4>
          {projects.length ? (
            <div className="cs-share-list">
              {projects.slice(0, 8).map(item => (
                <ShareBar
                  key={item.name}
                  name={item.name}
                  seconds={item.seconds}
                  totalSeconds={totalSeconds}
                  color="#4c7fbb"
                />
              ))}
            </div>
          ) : (
            <p className="small text-muted">
              {t('no_data_yet', { defaultValue: 'No data yet.' })}
            </p>
          )}
        </div>
      </div>

      {editorsLine ? (
        <p className="small text-muted cs-tools-line">
          {t('tools', { defaultValue: 'Tools' })}: {editorsLine}
        </p>
      ) : null}
    </section>
  )
}
