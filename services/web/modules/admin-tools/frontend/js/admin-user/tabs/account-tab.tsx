import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getUserFacingMessage, postJSON } from '@/infrastructure/fetch-json'
import useAsync from '@/shared/hooks/use-async'
import { CopyToClipboard } from '@/shared/components/copy-to-clipboard'
import OLButton from '@/shared/components/ol/ol-button'
import OLFormControl from '@/shared/components/ol/ol-form-control'
import OLFormSwitch from '@/shared/components/ol/ol-form-switch'
import OLNotification from '@/shared/components/notification'
import { getAdminUser } from '../meta'
import { DetailsTable } from '../details-table'
import {
  AuthBadge,
  RoleBadge,
  StatusBadge,
} from '../../admin-users/components/users-table'
import type { UserDetails } from '../types'
import { BoolIcon, FullDate } from './shared'

type Form = {
  email: string
  firstName: string
  lastName: string
  password: string
  isAdmin: boolean
}

const formFrom = (user: UserDetails): Form => ({
  email: user.email,
  firstName: user.firstName ?? '',
  lastName: user.lastName ?? '',
  password: '',
  isAdmin: user.isAdmin,
})

// What the update endpoint answers: the fields it changed
type Update = Partial<Pick<UserDetails, 'email' | 'firstName' | 'lastName' | 'isAdmin'>>

function AccountTab({
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
  const { deleter, sessionUserId } = getAdminUser()
  const [form, setForm] = useState<Form>(() => formFrom(user))
  const { isLoading, isSuccess, isError, error, runAsync, reset } =
    useAsync<Update>()

  const isSelf = user.id === sessionUserId
  // names synced from the login
  // provider, the admin flag set by it, and the own admin rights stay
  const canEditNames = !user.locked.details
  const canEditAdmin = !user.locked.isAdmin && !isSelf

  const change = (update: Partial<Form>) => {
    reset()
    setForm(prev => ({ ...prev, ...update }))
  }

  // only the changed fields go to the update endpoint
  const body: Record<string, unknown> = {}
  if (form.email.trim().toLowerCase() !== user.email) body.email = form.email
  if (canEditNames && form.firstName !== (user.firstName ?? ''))
    body.firstName = form.firstName
  if (canEditNames && form.lastName !== (user.lastName ?? ''))
    body.lastName = form.lastName
  if (form.password) body.password = form.password
  if (canEditAdmin && form.isAdmin !== user.isAdmin) body.isAdmin = form.isAdmin
  const dirty = Object.keys(body).length > 0

  const save = () => {
    runAsync(postJSON(`/admin/user/${user.id}/update`, { body }))
      .then(update => {
        const saved = { ...user, ...update }
        // changeEmailAddress adds the new address unconfirmed as the
        // primary one and removes the old one
        if (update.email) {
          saved.emails = [
            { email: update.email, primary: true, confirmed: false },
            ...user.emails.filter(email => !email.primary),
          ]
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

  const removeEmail = (email: string) => {
    runAsync(postJSON(`/admin/user/${user.id}/remove-email`, { body: { email } }))
      .then(() =>
        onSaved({
          ...user,
          emails: user.emails.filter(item => item.email !== email),
        })
      )
      .catch(() => {})
  }

  const input = (
    key: 'firstName' | 'lastName',
    canEdit: boolean,
    value?: string
  ) =>
    editing ? (
      <OLFormControl
        key={key}
        id={`admin-user-${key}`}
        className="admin-panel-input"
        size="sm"
        maxLength={255}
        readOnly={!canEdit}
        value={form[key]}
        onChange={event => change({ [key]: event.target.value })}
      />
    ) : (
      value
    )

  const rows: [string, React.ReactNode][] = [
    [
      'ID',
      // core's copy button, as the share modal's copy link
      <span key="id" className="admin-panel-copy">
        <code>{user.id}</code>
        <CopyToClipboard content={user.id} tooltipId="admin-user-copy-id" />
      </span>,
    ],
    [
      t('emails'),
      <ul key="emails" className="admin-panel-email-list list-unstyled mb-0">
        {user.emails.map(email => (
          <li key={email.email} className="admin-panel-inline-field">
            {email.primary && editing ? (
              <OLFormControl
                id="admin-user-email"
                className="admin-panel-input"
                size="sm"
                type="email"
                maxLength={255}
                value={form.email}
                onChange={event => change({ email: event.target.value })}
              />
            ) : (
              email.email
            )}
            {email.primary && (
              <span className="admin-panel-badge admin-panel-badge-info">{t('primary')}</span>
            )}
            {!email.confirmed && (
              <span className="admin-panel-badge">
                {t('unconfirmed')}
              </span>
            )}
            {/* a deleted user has no editing, and needs this to come back
                without an email another account uses now */}
            {(editing || user.deleted) && !email.primary && (
              <OLButton
                variant="secondary"
                size="sm"
                disabled={isLoading}
                onClick={() => removeEmail(email.email)}
              >
                {t('remove')}
              </OLButton>
            )}
          </li>
        ))}
      </ul>,
    ],
    [t('first_name'), input('firstName', canEditNames, user.firstName)],
    [t('last_name'), input('lastName', canEditNames, user.lastName)],
    [
      t('login'),
      <div key="login">
        <div className="admin-panel-badges">
          {user.authMethods.map(method => (
            <AuthBadge
              key={method.type === 'oidc' ? method.providerId : method.type}
              method={method}
            />
          ))}
        </div>
        {user.identifiers.map(id => (
          <div key={`${id.type}-${id.providerId}`} className="admin-panel-muted">
            {id.type === 'saml' ? t('saml') : id.name}:{' '}
            <code>{id.externalUserId}</code>
          </div>
        ))}
      </div>,
    ],
    [
      editing && user.hasPassword ? t('new_password') : t('password'),
      // an account without a local password logs in through SSO only
      editing && user.hasPassword ? (
        <OLFormControl
          key="pw"
          id="admin-user-password"
          className="admin-panel-input"
          size="sm"
          type="password"
          autoComplete="new-password"
          placeholder="********"
          value={form.password}
          onChange={event => change({ password: event.target.value })}
        />
      ) : (
        <BoolIcon key="pw" value={user.hasPassword} label={t('password')} />
      ),
    ],
    [
      t('role'),
      editing ? (
        <div key="role" className="admin-panel-inline-field">
          <span className="admin-panel-switch-label">{t('admin_titlecase')}</span>
          <OLFormSwitch
            id="admin-user-is-admin"
            label={t('admin_titlecase')}
            checked={form.isAdmin}
            disabled={!canEditAdmin}
            onChange={event => change({ isAdmin: event.target.checked })}
          />
        </div>
      ) : (
        <RoleBadge key="role" isAdmin={user.isAdmin} />
      ),
    ],
    [t('status'), <StatusBadge key="status" user={user} />],
    [t('sign_up'), <FullDate key="signup" date={user.signUpDate} />],
    [t('last_logged_in'), <FullDate key="login-at" date={user.lastLoggedIn} />],
    [t('ip_address'), user.lastLoginIp],
    [t('last_active'), <FullDate key="active" date={user.lastActive} />],
    [t('login_count'), user.loginCount],
  ]
  if (user.deleted) {
    rows.push(
      [t('deleted_at'), <FullDate key="deleted" date={user.deletedAt} />],
      [
        t('deleted_by_email'),
        deleter?.id ? <a href={`/admin/user/${deleter.id}`}>{deleter.email ?? deleter.id}</a> : null,
      ],
      [t('deleted_by_ip'), deleter?.ipAddress]
    )
  }

  return (
    <>
      <DetailsTable rows={rows} />
      {/* Cancel and Save centred under the table, as the sessions tab's
          button */}
      {editing && (
        <div className="admin-panel-form-actions">
          <OLButton variant="secondary" onClick={cancel} disabled={isLoading}>
            {t('cancel')}
          </OLButton>
          <OLButton
            variant="primary"
            onClick={save}
            disabled={!dirty || !form.email.trim()}
            isLoading={isLoading}
            loadingLabel={t('saving')}
          >
            {t('save')}
          </OLButton>
        </div>
      )}
      {isSuccess && !editing && (
        <p className="text-success text-center mt-2 mb-0" aria-live="polite">
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

export default AccountTab
