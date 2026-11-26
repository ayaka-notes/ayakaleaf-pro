import React, { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getJSON } from '@/infrastructure/fetch-json'

// overleaf-lab (owner request 2026-08-28): the LLM usage meter — token
// accounting for the admin page (whole site) and /user/llm-settings (my
// tokens). Read-only, dependency-free (pure-CSS bars), and deliberately
// non-critical: any fetch/parse problem renders a muted "unavailable" note
// instead of breaking the settings page.

type DayPoint = { day: string; calls: number; totalTokens: number }
type Breakdown = { action?: string; model?: string; calls: number; totalTokens: number }
type Summary = {
  days: number
  calls: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  byDay: DayPoint[]
  byAction: Breakdown[]
  byModel: Breakdown[]
}

function fmtTokens(n: number | null | undefined) {
    const v = Math.max(0, Number(n) || 0)
    if (v >= 1000000) {
        return (v / 1000000).toFixed(1) + 'M'
    }
    if (v >= 1000) {
        return (v / 1000).toFixed(1) + 'k'
    }
    return String(v)
}

export default function LLMUsageMeter({ scope, days = 30 }: { scope: 'admin' | 'user'; days?: number }) {
    const { t } = useTranslation()
    const [state, setState] = useState<'loading' | 'ready' | 'unavailable'>('loading')
    const [data, setData] = useState<Summary | null>(null)
    const [unavailableMsg, setUnavailableMsg] = useState('')

    useEffect(() => {
        let alive = true
        const url = scope === 'admin' ? `/admin/llm/usage?days=${days}` : `/user/llm-usage?days=${days}`
        getJSON(url)
            .then(res => {
                if (!alive) {
                    return
                }
                if (res && res.ok && Array.isArray(res.byDay)) {
                    setData(res as unknown as Summary)
                    setState('ready')
                } else {
                    setUnavailableMsg((res && res.message) || (res && res.error) || '')
                    setState('unavailable')
                }
            })
            .catch(err => {
                if (!alive) {
                    return
                }
                setUnavailableMsg(typeof err === 'string' ? err : err?.message || '')
                setState('unavailable')
            })
        return () => {
            alive = false
        }
    }, [scope, days])

    if (state === 'loading') {
        return (
            <div className="llm-usage" role="status">
                {t('llm_loading', 'Loading…')}
            </div>
        )
    }

    if (state === 'unavailable' || !data) {
        return (
            <div className="llm-usage llm-usage-muted">
                {t('llm_usage_unavailable', 'Usage statistics are not available right now.')}
                {unavailableMsg ? ` (${unavailableMsg})` : ''}
            </div>
        )
    }

    const maxDay = Math.max(1, ...(data.byDay || []).map(d => d.totalTokens))
    
    return (
        <div className="llm-usage" data-testid={`llm-usage-${scope}`}>
            <div className="llm-usage-stats">
                <div className="llm-usage-stat">
                    <span className="llm-usage-stat-value">{data.calls}</span>
                    <span className="llm-usage-stat-label">{t('llm_usage_calls', 'Requests')}</span>
                </div>
                <div className="llm-usage-stat">
                    <span className="llm-usage-stat-value">{fmtTokens(data.inputTokens)}</span>
                    <span className="llm-usage-stat-label">{t('llm_usage_input', 'Input tokens')}</span>
                </div>
                <div className="llm-usage-stat">
                    <span className="llm-usage-stat-value">{fmtTokens(data.outputTokens)}</span>
                    <span className="llm-usage-stat-label">{t('llm_usage_output', 'Output tokens')}</span>
                </div>
                <div className="llm-usage-stat">
                    <span className="llm-usage-stat-value">{fmtTokens(data.totalTokens)}</span>
                    <span className="llm-usage-stat-label">{t('llm_usage_total', 'Total tokens')}</span>
                </div>
            </div>

            {(data.byDay || []).length > 0 && (
                <div className="llm-usage-chart">
                    <span className="llm-usage-chart-caption">{t('llm_usage_chart', 'Daily token usage')}</span>
                    <div
                        className="llm-usage-bars"
                        role="img"
                        aria-label={t('llm_usage_chart', 'Daily token usage')}
                    >
                        {(data.byDay || []).map(d => (
                            <span
                                key={d.day}
                                className="llm-usage-bar"
                                title={d.day}
                                style={{ height: `${Math.max(d.totalTokens ? 8 : 0, Math.round((d.totalTokens / maxDay) * 100))}%` }}
                            />
                        ))}
                    </div>
                </div>
            )}

            {(data.byAction || []).length > 0 && (
                <div className="llm-usage-bd">
                    <span className="llm-usage-bd-title">{t('llm_usage_by_feature', 'By feature')}</span>
                    {(data.byAction || [])
                        .slice(0, 5)
                        .map(a => (
                            <div className="llm-usage-bd-row" key={a.action}>
                                <span className="llm-usage-bd-name">{a.action}</span>
                                <span className="llm-usage-bd-val">
                                    {a.calls} · {fmtTokens(a.totalTokens)} {t('tokens', 'tokens')}
                                </span>
                            </div>
                        ))}
                </div>
            )}

            {(data.byModel || []).length > 0 && (
                <div className="llm-usage-bd">
                    <span className="llm-usage-bd-title">{t('llm_usage_by_model', 'By model')}</span>
                    {(data.byModel || [])
                        .slice(0, 4)
                        .map(m => (
                            <div className="llm-usage-bd-row" key={m.model}>
                                <span className="llm-usage-bd-name llm-usage-bd-name-model">{m.model}</span>
                                <span className="llm-usage-bd-val">
                                    {m.calls} · {fmtTokens(m.totalTokens)} {t('tokens', 'tokens')}
                                </span>
                            </div>
                        ))}
                </div>
            )}
        </div>
    )
}
