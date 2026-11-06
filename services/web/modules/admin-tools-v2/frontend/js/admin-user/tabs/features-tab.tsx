import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getJSON, getUserFacingMessage, postJSON } from '@/infrastructure/fetch-json'
import useAsync from '@/shared/hooks/use-async'
import { debugConsole } from '@/utils/debugging'
import OLButton from '@/shared/components/ol/ol-button'
import OLFormControl from '@/shared/components/ol/ol-form-control'
import OLFormSwitch from '@/shared/components/ol/ol-form-switch'
import OLNotification from '@/shared/components/notification'
import { DetailsTable } from '../details-table'
import type { UserDetails } from '../types'
import { BoolIcon } from './shared'

type AiUsage = { used: number; limit: number | null }

// the switches, grouped as the tab shows them
const BOOL_FEATURES = {
  collaboration: ['trackChanges', 'versioning'],
  editor: ['symbolPalette'],
  integrations: ['gitBridge', 'dropbox', 'github', 'zotero', 'mendeley'],
} as const
type BoolFeature = (typeof BOOL_FEATURES)[keyof typeof BOOL_FEATURES][number]
const ALL_BOOL_FEATURES = Object.values(BOOL_FEATURES).flat()

type Form = Record<BoolFeature, boolean> & {
  collaborators: string
  compileTimeout: string
  aiEnabled: boolean
}

// everything is on unless an admin turned it off: a feature the defaults
// leave unset counts as on, as in CE nothing checks it yet
const isOn = (features: Record<string, unknown>, key: string) =>
  features[key] !== false

const formFrom = (user: UserDetails): Form => {
  const f = user.features
  return {
    ...(Object.fromEntries(
      ALL_BOOL_FEATURES.map(key => [key, isOn(f, key)])
    ) as Record<BoolFeature, boolean>),
    collaborators: String(f.collaborators ?? ''),
    compileTimeout: String(f.compileTimeout ?? ''),
    aiEnabled: user.aiEnabled,
  }
}

// the update endpoint's limits: -1 is unlimited; 1 to 600 seconds
const validCollaborators = (value: string) =>
  /^-?\d+$/.test(value) && Number(value) >= -1
const validCompileTimeout = (value: string) =>
  /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 600

function FeaturesTab({
  user,
  onSaved,
  editing,
  onEditingChange,
}: {
  user: UserDetails
  onSaved: (user: UserDetails) => void
  // read only until the pencil in the page header is clicked
  editing: boolean
  onEditingChange: (editing: boolean) => void
}) {
  const { t } = useTranslation()
  const f = user.features
  const [form, setForm] = useState<Form>(() => formFrom(user))
  const { isLoading, isSuccess, isError, error, runAsync, reset } =
    useAsync<{ features?: Record<string, unknown>; aiFeatures?: { enabled: boolean } }>()
  const [aiUsage, setAiUsage] = useState<AiUsage | null>(null)
  const aiReset = useAsync<AiUsage>()

  useEffect(() => {
    // the existing endpoint
    getJSON(`/admin/user/${user.id}/ai-usage`)
      .then(setAiUsage)
      .catch(debugConsole.error)
  }, [user.id])

  // the usage of this quota period back to zero, at once (not part of the
  // form)
  const resetAiUsage = () => {
    aiReset
      .runAsync(postJSON(`/admin/user/${user.id}/ai-usage/reset`))
      .then(setAiUsage)
      .catch(debugConsole.error)
  }

  const change = (update: Partial<Form>) => {
    reset()
    setForm(prev => ({ ...prev, ...update }))
  }

  const validForm =
    validCollaborators(form.collaborators) &&
    validCompileTimeout(form.compileTimeout)

  // only the changed values go to the update endpoint
  const features: Record<string, unknown> = {}
  for (const key of ALL_BOOL_FEATURES) {
    if (form[key] !== isOn(f, key)) features[key] = form[key]
  }
  if (validForm) {
    if (Number(form.collaborators) !== f.collaborators)
      features.collaborators = Number(form.collaborators)
    if (Number(form.compileTimeout) !== f.compileTimeout)
      features.compileTimeout = Number(form.compileTimeout)
  }
  const body: Record<string, unknown> = {}
  if (Object.keys(features).length > 0) body.features = features
  if (form.aiEnabled !== user.aiEnabled)
    body.aiFeatures = { enabled: form.aiEnabled }
  const dirty = Object.keys(body).length > 0

  const save = () => {
    runAsync(postJSON(`/admin/user/${user.id}/update`, { body }))
      .then(update => {
        const saved = {
          ...user,
          features: update.features ?? user.features,
          aiEnabled: update.aiFeatures?.enabled ?? user.aiEnabled,
        }
        onSaved(saved)
        setForm(formFrom(saved))
        onEditingChange(false)
      })
      .catch(() => {})
  }

  const cancel = () => {
    reset()
    setForm(formFrom(user))
    onEditingChange(false)
  }

  const labels: Record<BoolFeature, string> = {
    trackChanges: t('track_changes'),
    versioning: t('full_project_history'),
    symbolPalette: t('symbol_palette'),
    gitBridge: t('git_integration'),
    dropbox: t('dropbox'),
    github: t('github'),
    zotero: t('zotero'),
    mendeley: t('mendeley'),
  }

  const toggle = (
    key: string,
    label: string,
    on: boolean,
    checked: boolean,
    onChange: (checked: boolean) => void
  ): [string, React.ReactNode] => [
    label,
    editing ? (
      <OLFormSwitch
        key={key}
        id={`admin-user-feature-${key}`}
        label={label}
        checked={checked}
        onChange={event => onChange(event.target.checked)}
      />
    ) : (
      <BoolIcon key={key} value={on} label={label} />
    ),
  ]

  const boolRow = (key: BoolFeature) =>
    toggle(key, labels[key], isOn(f, key), form[key], checked =>
      change({ [key]: checked })
    )

  const numberInput = (
    key: 'collaborators' | 'compileTimeout',
    valid: boolean,
    after: string
  ) => (
    <div key={key} className="admin-panel-inline-field">
      <OLFormControl
        id={`admin-user-feature-${key}`}
        className="admin-panel-input-number"
        size="sm"
        type="number"
        inputMode="numeric"
        isInvalid={!valid}
        value={form[key]}
        onChange={event => change({ [key]: event.target.value })}
      />
      <span className="admin-panel-muted admin-panel-switch-label">{after}</span>
    </div>
  )

  return (
    <>
      <h3 className="admin-panel-section-title">{t('collaboration')}</h3>
      <DetailsTable
        rows={[
          [
            t('collaborators_per_project'),
            editing
              ? numberInput(
                  'collaborators',
                  validCollaborators(form.collaborators),
                  `-1 = ${t('unlimited')}`
                )
              : f.collaborators === -1
                ? t('unlimited')
                : (f.collaborators as number | undefined),
          ],
          ...BOOL_FEATURES.collaboration.map(boolRow),
        ]}
      />

      <h3 className="admin-panel-section-title">{t('editor')}</h3>
      <DetailsTable
        rows={[
          [
            t('compile_timeout'),
            editing
              ? numberInput(
                  'compileTimeout',
                  validCompileTimeout(form.compileTimeout),
                  's (1–600)'
                )
              : f.compileTimeout != null
                ? `${f.compileTimeout}s`
                : null,
          ],
          ...BOOL_FEATURES.editor.map(boolRow),
        ]}
      />

      <h3 className="admin-panel-section-title">{t('integrations')}</h3>
      <DetailsTable rows={BOOL_FEATURES.integrations.map(boolRow)} />

      <h3 className="admin-panel-section-title">{t('ai_features')}</h3>
      <DetailsTable
        rows={[
          toggle('ai', t('enabled'), user.aiEnabled, form.aiEnabled, checked =>
            change({ aiEnabled: checked })
          ),
          [
            t('ai_usage'),
            aiUsage ? (
              <div key="ai-usage" className="admin-panel-inline-field">
                <span>
                  {aiUsage.used.toLocaleString()} /{' '}
                  {aiUsage.limit?.toLocaleString() ?? t('unlimited')}
                </span>
                <OLButton
                  variant="secondary"
                  size="sm"
                  onClick={resetAiUsage}
                  isLoading={aiReset.isLoading}
                  disabled={aiUsage.used === 0}
                >
                  {t('reset')}
                </OLButton>
              </div>
            ) : null,
          ],
        ]}
      />

      {/* Cancel and Save centred under the tables, as on the account tab */}
      {editing && (
        <div className="admin-panel-form-actions">
          <OLButton variant="secondary" onClick={cancel} disabled={isLoading}>
            {t('cancel')}
          </OLButton>
          <OLButton
            variant="primary"
            onClick={save}
            disabled={!dirty || !validForm}
            isLoading={isLoading}
            loadingLabel={t('saving')}
          >
            {t('save')}
          </OLButton>
        </div>
      )}
      {isSuccess && !editing && (
        <p className="text-success text-center mt-3 mb-0" aria-live="polite">
          {t('saved')}
        </p>
      )}
      {isError && (
        <OLNotification
          type="error"
          className="mt-3"
          content={
            getUserFacingMessage(error) ?? t('generic_something_went_wrong')
          }
        />
      )}
    </>
  )
}

export default FeaturesTab
