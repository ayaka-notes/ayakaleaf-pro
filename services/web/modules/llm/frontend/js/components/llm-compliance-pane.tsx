import React from 'react'
import { useTranslation } from 'react-i18next'
import MaterialIcon from '@/shared/components/material-icon'
import OLButton from '@/shared/components/ol/ol-button'
import { useLLMCompliance } from '../hooks/use-llm-compliance'
import { useLLMModelSelection } from '../hooks/use-llm-model-selection'
import type {
    ComplianceItem,
    ComplianceStatus,
} from '../hooks/use-llm-compliance'

// overleaf-lab: visual mapping for each requirement status. Colours reuse the
// app's design tokens with hard-coded fallbacks so the pane still reads well if
// a token is missing.
const STATUS_STYLE: Record<
    ComplianceStatus,
    { icon: string; color: string }
> = {
    ok: { icon: 'check_circle', color: 'var(--green-60, #198754)' },
    partial: { icon: 'warning', color: 'var(--yellow-60, #f59e0b)' },
    missing: { icon: 'cancel', color: 'var(--red-60, #dc3545)' },
    na: { icon: 'remove', color: 'var(--content-secondary, #6c757d)' },
}

// overleaf-lab: a muted-but-readable text color that adapts to the theme. It is a
// slightly faded version of the ADAPTIVE primary token (--content-primary-themed,
// the one that actually flips on dark), so grey text stays legible on the dark
// theme. If color-mix is unsupported the value is ignored and the text falls back
// to the inherited (readable) color.
const MUTED =
    'color-mix(in srgb, var(--content-primary-themed) 72%, transparent)'

// overleaf-lab: mm:ss for the progress readout.
function formatDuration(ms: number): string {
    const totalSeconds = Math.max(0, Math.round(ms / 1000))
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = totalSeconds % 60
    return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function ComplianceReportItem({ item }: { item: ComplianceItem }) {
    const { t } = useTranslation()
    const statusStyle = STATUS_STYLE[item.status] || STATUS_STYLE.na

    return (
        <div
            style={{
                display: 'flex',
                gap: 8,
                padding: '8px 0',
                borderTop: '1px solid var(--border-divider, rgba(125,125,125,0.2))',
                minWidth: 0,
            }}
        >
            <MaterialIcon
                type={statusStyle.icon}
                style={{ color: statusStyle.color, flexShrink: 0, marginTop: 2 }}
            />
            <div style={{ minWidth: 0, flex: 1, overflowWrap: 'anywhere' }}>
                <div style={{ fontWeight: 'bold' }}>{item.requirement}</div>
                {item.evidence && (
                    <div style={{ color: MUTED, fontSize: '0.85em', marginTop: 2 }}>
                        {t('evidence', 'Evidence')}: {item.evidence}
                    </div>
                )}
                {item.suggestion && (
                    <div style={{ fontStyle: 'italic', fontSize: '0.9em', marginTop: 2 }}>
                        {t('suggestion', 'Suggestion')}: {item.suggestion}
                    </div>
                )}
            </div>
        </div>
    )
}

function LLMCompliancePane() {
    const { t } = useTranslation()
    // overleaf-lab (owner request 2026-08-26): the per-pane model picker is
    // gone — the Review run still uses the ONE shared (user-scoped) selection,
    // made via File → "Select LLM Model".
    const { selected: selectedModel } = useLLMModelSelection()
    const {
        rubrics,
        rubricsLoaded,
        selectedRubricId,
        setSelectedRubricId,
        phase,
        position,
        progress,
        result,
        errorInfo,
        runReview,
        cancelReview,
        downloadReport,
        hasRubrics,
    } = useLLMCompliance()

    if (!rubricsLoaded) {
        return (
            <div style={{ padding: 12, color: MUTED }}>
                {t('loading', 'Loading')}...
            </div>
        )
    }

    if (!hasRubrics) {
        return (
            <div style={{ padding: 12, color: MUTED }}>
                {t(
                    'compliance_no_rubrics_pre',
                    'No review rubrics are configured for your profile yet. Add your own in your LLM settings ('
                )}
                <em>
                    {t('compliance_no_rubrics_path', 'AI Settings → Compliance Review')}
                </em>
                {t('compliance_no_rubrics_post', ')')}
            </div>
        )
    }

    // overleaf-lab: a job is active (in queue or running) while we poll it.
    const isActive = phase === 'queued' || phase === 'running'
    // overleaf-lab: the run button is only shown/enabled in the resting phases.
    const showRunButton = phase === 'idle' || phase === 'done' || phase === 'error'

    // overleaf-lab: map the fixed backend error codes to friendly copy. The code
    // now lives in errorInfo.errorCode.
    const renderError = (): React.ReactNode => {
        if (!errorInfo) return null

        let message: string
        switch (errorInfo.errorCode) {
            case 'too_long':
                message = t(
                    'review_too_long',
                    'The document plus the room reserved for the answer does not fit the review model context window. Shorten the document, or ask your administrator to lower the review answer budget or raise the context window.'
                )
                break
            case 'busy':
                message = t(
                    'review_busy',
                    'A review is already running. Please try again in a moment.'
                )
                break
            case 'model_unavailable':
                message = t(
                    'review_model_unavailable',
                    'The review model is not available on the backend right now.'
                )
                break
            case 'not_configured':
                message = t(
                    'review_not_configured',
                    'The LLM backend is not configured. Contact your administrator.'
                )
                break
            case 'empty_document':
                message = t('review_empty', 'This project has no text to review.')
                break
            case 'disabled':
                message = t('review_disabled', 'The AI service is disabled.')
                break
            case 'not_found':
                message = t(
                    'review_not_found',
                    'The review was not found or has expired.'
                )
                break
            default:
                message =
                    errorInfo.message ||
                    t('review_failed', 'The review failed. Please try again.')
        }

        const showTokens =
            errorInfo.errorCode === 'too_long' &&
            errorInfo.documentTokensEstimate != null &&
            errorInfo.maxContextTokens != null

        // overleaf-lab: show the WHOLE equation. The refusal is caused by
        // prompt + reserved answer room exceeding the limit, so printing only
        // "prompt / limit" showed numbers that looked like they fitted.
        const promptTokens = errorInfo.documentTokensEstimate || 0
        const answerTokens = errorInfo.reviewMaxTokens || 0
        const totalTokens = promptTokens + answerTokens

        return (
            <div
                style={{
                    marginTop: 12,
                    padding: 10,
                    borderRadius: 6,
                    color: 'var(--red-60, #dc3545)',
                    border: '1px solid var(--red-60, #dc3545)',
                    background: 'rgba(220,53,69,0.08)',
                    overflowWrap: 'anywhere',
                }}
            >
                <div>{message}</div>
                {showTokens && (
                    <div style={{ color: MUTED, fontSize: '0.85em', marginTop: 4 }}>
                        {answerTokens > 0 ? (
                            <>
                                {t('review_tokens_document', 'Document')}:{' '}
                                {promptTokens.toLocaleString()} +{' '}
                                {t('review_tokens_answer', 'reserved for the answer')}:{' '}
                                {answerTokens.toLocaleString()} ={' '}
                                {totalTokens.toLocaleString()}, {t('review_tokens_limit', 'limit')}:{' '}
                                {(errorInfo.maxContextTokens || 0).toLocaleString()}{' '}
                                {t('tokens', 'tokens')}
                            </>
                        ) : (
                            <>
                                {promptTokens.toLocaleString()} /{' '}
                                {(errorInfo.maxContextTokens || 0).toLocaleString()}{' '}
                                {t('tokens', 'tokens')}
                            </>
                        )}
                    </div>
                )}
            </div>
        )
    }

    const renderResult = (): React.ReactNode => {
        if (!result) return null

        const counts = result.items.reduce(
            (acc, item) => {
                acc[item.status] = (acc[item.status] || 0) + 1
                return acc
            },
            {} as Record<ComplianceStatus, number>
        )

        return (
            <div
                style={{
                    marginTop: 12,
                    display: 'flex',
                    flexDirection: 'column',
                    minHeight: 0,
                    flex: 1,
                }}
            >
                {/* overleaf-lab: download the report as Markdown */}
                <div
                    style={{
                        display: 'flex',
                        justifyContent: 'flex-end',
                        marginBottom: 8,
                    }}
                >
                    <OLButton
                        variant="secondary"
                        type="button"
                        onClick={downloadReport}
                    >
                        <MaterialIcon type="download" />{' '}
                        {t('download_report', 'Download report')}
                    </OLButton>
                </div>

                {/* overleaf-lab: nudge users to keep the report; a new review is a
                    heavy, minutes-long operation for the server. */}
                <div
                    style={{
                        fontSize: '0.8em',
                        color: MUTED,
                        marginBottom: 8,
                        overflowWrap: 'anywhere',
                    }}
                >
                    {t(
                        'review_download_hint',
                        'Tip: download this report to keep it. Running a new review is a heavy operation for the server, so avoid repeating it unnecessarily.'
                    )}
                </div>

                {/* overleaf-lab: compact counts summary */}
                <div
                    style={{
                        display: 'flex',
                        gap: 12,
                        flexWrap: 'wrap',
                        fontSize: '0.85em',
                        marginBottom: 8,
                    }}
                >
                    <span style={{ color: STATUS_STYLE.ok.color }}>
                        {t('status_ok', 'OK')}: {counts.ok || 0}
                    </span>
                    <span style={{ color: STATUS_STYLE.partial.color }}>
                        {t('status_partial', 'Partial')}: {counts.partial || 0}
                    </span>
                    <span style={{ color: STATUS_STYLE.missing.color }}>
                        {t('status_missing', 'Missing')}: {counts.missing || 0}
                    </span>
                    <span style={{ color: MUTED }}>
                        {t('status_na', 'N/A')}: {counts.na || 0}
                    </span>
                </div>

                {/* Summary block (synthesized in a final pass; may be empty if that
                    best-effort call failed, in which case show nothing) */}
                {result.summary && (
                    <div
                        style={{
                            padding: 10,
                            borderRadius: 6,
                            // overleaf-lab: translucent grey (works on light and dark)
                            // instead of the fixed light --bg-light-secondary, which was
                            // a white box on the dark theme, and an adaptive text color.
                            background: 'rgba(125,125,125,0.14)',
                            color: 'var(--content-primary-themed)',
                            overflowWrap: 'anywhere',
                        }}
                    >
                        {result.summary}
                    </div>
                )}

                <div style={{ color: MUTED, fontSize: '0.85em', marginTop: 6 }}>
                    {t('model_label', 'Model')}: {result.model} - ~
                    {result.documentTokensEstimate} {t('tokens', 'tokens')}
                </div>

                {/* Scrollable requirements list */}
                <div
                    style={{
                        marginTop: 8,
                        overflowY: 'auto',
                        overflowX: 'hidden',
                        minHeight: 0,
                        flex: 1,
                    }}
                >
                    {result.items.map((item, idx) => (
                        <ComplianceReportItem key={idx} item={item} />
                    ))}
                </div>
            </div>
        )
    }

    return (
        <div
            style={{
                display: 'flex',
                flexDirection: 'column',
                minHeight: 0,
                flex: 1,
                padding: 12,
                overflow: 'hidden',
            }}
        >
            {/* Header row: rubric selector + run button. overleaf-lab (owner
                request 2026-08-26): the model picker is gone — File → "Select
                LLM Model" is the sole selection entry point. */}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <select
                    className="form-select"
                    value={selectedRubricId}
                    onChange={e => setSelectedRubricId(e.target.value)}
                    disabled={isActive}
                    aria-label={t('review_rubric', 'Review rubric')}
                    style={{ flex: 1, minWidth: 0 }}
                >
                    {rubrics.map(rubric => (
                        <option key={rubric.id} value={rubric.id}>
                            {rubric.name}
                        </option>
                    ))}
                </select>
                {showRunButton && (
                    <OLButton
                        variant="primary"
                        type="button"
                        onClick={() => runReview(selectedModel || undefined)}
                        disabled={!selectedRubricId}
                    >
                        <MaterialIcon type="fact_check" />{' '}
                        {t('run_review', 'Run review')}
                    </OLButton>
                )}
            </div>

            {/* overleaf-lab: queued state - position note + cancel */}
            {phase === 'queued' && (
                <div style={{ marginTop: 12, color: MUTED }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <MaterialIcon type="schedule" />
                        <span>{t('review_queued', 'In queue')}</span>
                    </div>
                    {position > 0 && (
                        <div style={{ marginTop: 4, fontSize: '0.85em' }}>
                            {t('review_queue_position', 'Requests ahead of you:')}{' '}
                            {position}
                        </div>
                    )}
                    <div style={{ marginTop: 8 }}>
                        <OLButton
                            variant="secondary"
                            type="button"
                            onClick={cancelReview}
                        >
                            <MaterialIcon type="close" /> {t('cancel', 'Cancel')}
                        </OLButton>
                    </div>
                </div>
            )}

            {/* overleaf-lab: running state - real pass-based progress + cancel.
                The review runs one model call per rubric requirement, so the bar
                moves on actual completions, not on a time estimate. */}
            {phase === 'running' && (
                <div style={{ marginTop: 12 }}>
                    <div
                        style={{
                            display: 'flex',
                            gap: 8,
                            alignItems: 'center',
                            color: MUTED,
                        }}
                    >
                        <MaterialIcon
                            type={
                                progress?.phase === 'summarizing'
                                    ? 'edit_note'
                                    : progress?.phase === 'checking'
                                      ? 'rule'
                                      : 'hourglass_empty'
                            }
                        />
                        <span>
                            {progress?.phase === 'summarizing'
                                ? t('review_summarizing', 'Writing the summary...')
                                : progress?.phase === 'checking'
                                  ? t('review_checking', 'Checking requirement') +
                                    ` ${Math.min(progress.passesDone + 1, progress.passesTotal)}/${progress.passesTotal}`
                                  : t(
                                        'review_preparing',
                                        'Preparing the document...'
                                    )}
                        </span>
                    </div>

                    {/* overleaf-lab: the requirement being checked right now */}
                    {progress?.phase === 'checking' && progress.currentRequirement && (
                        <div
                            style={{
                                marginTop: 4,
                                fontSize: '0.8em',
                                color: MUTED,
                                overflowWrap: 'anywhere',
                            }}
                        >
                            {progress.currentRequirement}
                        </div>
                    )}

                    {progress && progress.passesTotal > 0 && (
                        <>
                            <div
                                style={{
                                    marginTop: 8,
                                    height: 8,
                                    borderRadius: 4,
                                    background: 'rgba(125,125,125,0.2)',
                                    overflow: 'hidden',
                                }}
                            >
                                <div
                                    style={{
                                        height: '100%',
                                        width: `${Math.round(
                                            (progress.phase === 'summarizing'
                                                ? 0.97
                                                : progress.passesDone /
                                                  progress.passesTotal) * 100
                                        )}%`,
                                        background: 'var(--green-60, #198754)',
                                        transition: 'width 0.5s ease',
                                    }}
                                />
                            </div>
                            <div
                                style={{
                                    marginTop: 4,
                                    fontSize: '0.8em',
                                    color: MUTED,
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    gap: 8,
                                }}
                            >
                                <span>{formatDuration(progress.elapsedMs)}</span>
                                {/* Same index as the "Checking requirement" label above:
                                    the pass being worked on, not the completed count,
                                    so the two numbers never disagree on screen. */}
                                <span>
                                    {Math.min(
                                        progress.passesDone + 1,
                                        progress.passesTotal
                                    )}
                                    /{progress.passesTotal}
                                </span>
                            </div>
                        </>
                    )}

                    <div style={{ marginTop: 8 }}>
                        <OLButton
                            variant="secondary"
                            type="button"
                            onClick={cancelReview}
                        >
                            <MaterialIcon type="close" /> {t('cancel', 'Cancel')}
                        </OLButton>
                    </div>
                </div>
            )}

            {phase === 'error' && renderError()}
            {phase === 'done' && renderResult()}
        </div>
    )
}

export default LLMCompliancePane
