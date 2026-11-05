import React, { useEffect, useState } from 'react'
import { Card } from 'react-bootstrap'
import { useTranslation } from 'react-i18next'
import OLRow from '@/shared/components/ol/ol-row'
import OLCol from '@/shared/components/ol/ol-col'
import OLCard from '@/shared/components/ol/ol-card'
import OLBadge from '@/shared/components/ol/ol-badge'
import { formatDate } from '@/utils/dates'
import UsersActionModal from './users-action-modal'
import { getAdditionalUserInfo, getLlmUsage, type LlmUsage } from '../../util/api'

type ShowUserInfoModalProps = Pick<
  React.ComponentProps<typeof UsersActionModal>,
  'users' | 'showModal' | 'handleCloseModal'
>

function InfoRow({
  label,
  value,
}: {
  label: string
  value: React.ReactNode
}) {
  return (
    <OLRow className="mb-2">
      <OLCol xs={4} className="fw-semibold text-muted">
        {label}
      </OLCol>
      <OLCol xs={8}>{value}</OLCol>
    </OLRow>
  )
}

function ShowUserInfoModal({
  users,
  showModal,
  handleCloseModal,
}: ShowUserInfoModalProps) {
  const { t } = useTranslation()

  if (users.length !== 1) return null
  const user = users[0]

  const [activationLink, setActivationLink] = useState<string | null>(null)
   const [copied, setCopied] = useState(false)
  // overleaf-lab (2026-11-05, TODO-9613994b): AI usage ledger of this user,
  // loaded on open; 'loading' | 'error' before/without data.
  const [llmUsage, setLlmUsage] = useState<LlmUsage | null>(null)
  const [llmUsageState, setLlmUsageState] = useState<'loading' | 'ok' | 'error' | 'empty'>('loading')
  useEffect(() => {
    if (!showModal) return
    let cancelled = false
    setLlmUsageState('loading')
    getLlmUsage(user.id, 30)
      .then((u) => {
        if (cancelled) return
        if (u && typeof u.totalTokens === 'number') {
          setLlmUsage(u)
          setLlmUsageState(u.calls > 0 ? 'ok' : 'empty')
        } else {
          setLlmUsage(null)
          setLlmUsageState('error')
        }
      })
      .catch(() => {
        if (cancelled) return
        setLlmUsage(null)
        setLlmUsageState('error')
      })
    return () => {
      cancelled = true
    }
  }, [showModal, user.id])

  useEffect(() => {
    if (!showModal) return

    getAdditionalUserInfo(user.id)
      .then(({ activationLink }) => {
        setActivationLink(activationLink)
      })
      .catch(() => {
        setActivationLink(null)
      })
  }, [showModal, user.id])

  const handleCopy = () => {
    if (!activationLink) return

    const markCopied = () => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }

    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(activationLink).then(markCopied)
      return
    }

    // fallback for older browsers
    const tempInput = document.createElement('input')
    tempInput.value = activationLink
    tempInput.style.position = 'fixed'
    tempInput.style.opacity = '0'
    document.body.appendChild(tempInput)
    tempInput.select()
    document.execCommand('copy')
    document.body.removeChild(tempInput)

    markCopied()
  }

  return (
    <UsersActionModal
      action="info"
      title={t('info')}
      showModal={showModal}
      handleCloseModal={handleCloseModal}
      users={users}
    >
      <OLCard className="mb-3">
        {(Body) => (
          <>
            <Card.Header>{t('Account')}</Card.Header>
            <Body>
              <InfoRow label={t('id')} value={user.id} />
              <InfoRow label={t('email_address')} value={user.email} />
              <InfoRow label={t('first_name')} value={user.firstName || '—'} />
              <InfoRow label={t('last_name')} value={user.lastName || '—'} />

              {user.isAdmin && (
                <InfoRow
                  label={t('role')}
                  value={
                    <OLBadge bg="danger">
                      {t('admin')}
                    </OLBadge>
                  }
                />
              )}
              {activationLink && (
                <InfoRow 
                  label={t('activate_account')}
                  value={
                    <span
                      style={{ cursor: 'pointer', textDecoration: 'underline' }}
                      onClick={handleCopy}
                    >
                      {activationLink}
                      {copied && (
                        <span className="ms-2 text-success">
                          ({t('copied')})
                        </span>
                      )}
                    </span>
                  }
                />
              )}
            </Body>
          </>
        )}
      </OLCard>

      <OLCard>
        {(Body) => (
          <>
            <Card.Header>{t('actions')}</Card.Header>
            <Body>
              <InfoRow
                label={t('sign_up')}
                value={formatDate(user.signUpDate)}
              />
              <InfoRow
                label={t('last_logged_in')}
                value={
                  user.lastLoggedIn
                    ? formatDate(user.lastLoggedIn)
                    : t('unknown')
                }
              />
              <InfoRow
                label={t('last_active')}
                value={
                  user.lastActive
                    ? formatDate(user.lastActive)
                    : t('unknown')
                }
              />
              <InfoRow
                label={t('login_count')}
                value={user.loginCount}
              />
            </Body>
          </>
        )}
      </OLCard>
      {llmUsageState !== 'loading' && (
        <OLCard>
          {(Body) => (
            <>
              <Card.Header>{t('llm_admin_usage_title', 'AI usage (LLM ledger)')}</Card.Header>
              <Body>
                {llmUsageState === 'error' && (
                  <InfoRow
                    label={t('llm_admin_usage_unavailable', 'Status')}
                    value={t('llm_admin_usage_error', 'Usage data unavailable right now.')}
                  />
                )}
                {llmUsageState === 'empty' && (
                  <InfoRow
                    label={t('llm_admin_usage_none', 'Status')}
                    value={t('llm_admin_usage_norecords', 'No LLM calls recorded for this user in the last 30 days.')}
                  />
                )}
                {llmUsageState === 'ok' && (
                  <>
                    <LlmUsageRows usage={llmUsage} t={t} />
                  </>
                )}
              </Body>
            </>
          )}
        </OLCard>
      )}
    </UsersActionModal>
  )
}

// overleaf-lab (2026-11-05, TODO-9613994b): compact rendering of the user's
// LLM ledger: totals, busy days, per-action split, and the live model
// selection (default + per-task overrides with BYO row names).
function fmtTok(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k'
  return String(n)
}
function modelName(value: string, rowNames: Record<string, string>): string {
  if (!value) return '—'
  const m = value.match(/^u:([^:]+):(.+)$/)
  if (m) {
    const row = rowNames[m[1]] || m[1]
    return `${row} · ${m[2]}`
  }
  return value
}
function LlmUsageRows({
  usage,
  t,
}: {
  usage: LlmUsage
  // overleaf-lab: react-i18next's t is overloaded; accept any (key, default)
  // calling signature to stay assignment-compatible.
  t: (key: string, ...rest: unknown[]) => string
}) {
  const busyDays = usage.byDay.filter(d => d.totalTokens > 0).slice(-7)
  const sel = usage.selection || { default: '', tasks: {}, rowNames: {} }
  const tasks: Array<[string, string]> = [
    ['chat', t('llm_task_chat', 'Chat (AI Assistant)')],
    ['completion', t('llm_task_completion', 'Inline completion')],
    ['review', t('llm_task_review', 'Compliance review')],
    ['error', t('llm_task_error', 'Error analysis')],
  ]
  return (
    <>
      <InfoRow
        label={t('llm_admin_usage_requests', 'Requests (30 days)')}
        value={usage.calls}
      />
      <InfoRow
        label={t('llm_admin_usage_in', 'Input tokens')}
        value={fmtTok(usage.inputTokens)}
      />
      <InfoRow
        label={t('llm_admin_usage_out', 'Output tokens')}
        value={fmtTok(usage.outputTokens)}
      />
      <InfoRow
        label={t('llm_admin_usage_total', 'Total tokens')}
        value={fmtTok(usage.totalTokens)}
      />
      {busyDays.length > 0 && (
        <InfoRow
          label={t('llm_admin_usage_days', 'Busy days (last 7 active)')}
          value={
            busyDays
              .map(d => `${d.day.slice(5)}: ${fmtTok(d.totalTokens)}`)
              .join(' · ')
          }
        />
      )}
      {usage.byAction.length > 0 && (
        <InfoRow
          label={t('llm_admin_usage_actions', 'By action')}
          value={
            usage.byAction
              .slice(0, 5)
              .map(a => `${a.action} (${fmtTok(a.totalTokens)})`)
              .join(' · ')
          }
        />
      )}
      <InfoRow
        label={t('llm_admin_usage_default', 'Default model (all tasks)')}
        value={modelName(sel.default, sel.rowNames || {})}
      />
      {tasks.map(([key, label]) =>
        sel.tasks && sel.tasks[key] ? (
          <InfoRow key={key} label={label} value={modelName(sel.tasks[key], sel.rowNames || {})} />
        ) : null,
      )}
    </>
  )
}
export default ShowUserInfoModal

