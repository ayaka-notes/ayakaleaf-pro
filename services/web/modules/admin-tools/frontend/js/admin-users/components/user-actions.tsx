import { ReactNode, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import classnames from 'classnames'
import {
  deleteJSON,
  getUserFacingMessage,
  postJSON,
} from '@/infrastructure/fetch-json'
import useAsync from '@/shared/hooks/use-async'
import { CopyToClipboard } from '@/shared/components/copy-to-clipboard'
import OLButton from '@/shared/components/ol/ol-button'
import OLIconButton from '@/shared/components/ol/ol-icon-button'
import OLTooltip from '@/shared/components/ol/ol-tooltip'
import OLFormCheckbox from '@/shared/components/ol/ol-form-checkbox'
import OLFormGroup from '@/shared/components/ol/ol-form-group'
import OLFormLabel from '@/shared/components/ol/ol-form-label'
import OLFormControl from '@/shared/components/ol/ol-form-control'
import OLNotification from '@/shared/components/notification'
import {
  OLModal,
  OLModalBody,
  OLModalFooter,
  OLModalHeader,
  OLModalTitle,
} from '@/shared/components/ol/ol-modal'
import { getOptions } from '../meta'
import OwnerPicker, { type OwnerOption } from '../../shared/owner-picker'
import { BulkError } from '../../shared/selection'
import type { AdminUser } from '../types'

// The admin endpoints, kept as they are
export type Action = {
  key: string
  icon: string
  label: string
  danger?: boolean
  intro?: string
  warning?: string
  // a new owner to pick: always (transfer, change owner) or behind the
  // "transfer this user's projects" checkbox (delete)
  pickOwner?: 'required' | 'optional'
  // who cannot be picked: the user whose projects move, the current owner
  ownerExcludeIds?: string[]
  // greyed out: it means nothing here
  disabled?: boolean
  // how long the links last: run answers links to hand out, which the modal
  // then stays open to show
  linkNote?: string
  run: (options: { sendEmail: boolean; toUserId: string | null }) => Promise<unknown>
}

// what the endpoints of the links answer
export type SentLink = { link: string; emailSent: boolean }
type PasswordLink = SentLink & { title: string; detail?: string }

// A link to set a password takes a local password (an SSO account has none to
// set) on an account that can log in
const canSetPassword = (user: AdminUser) =>
  !user.suspended && user.authMethods.some(method => method.type === 'local')

// core's /user/activate only takes an account that never logged in
export const waitsForActivation = (user: AdminUser) =>
  canSetPassword(user) && !user.loginCount

// a user in the confirm modal: the name (or the email) and the email
export const userSubject = (user: AdminUser) => ({
  title:
    [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email,
  detail: user.email,
})

// An activation for an account that never logged in, a password reset for one
// that has
function passwordLinkAction(t: TFunction, user: AdminUser): Action {
  const send = (path: string) => () =>
    postJSON<SentLink>(`/admin/user/${user.id}/${path}`).then(sent => [
      { ...userSubject(user), ...sent },
    ])
  return user.loginCount
    ? {
        key: 'send-reset',
        icon: 'lock_reset',
        label: t('send_reset_link'),
        disabled: !canSetPassword(user),
        linkNote: t('expires_in_one_hour'),
        run: send('send-password-reset'),
      }
    : {
        key: 'resend',
        icon: 'mail',
        label: t('send_activation_email'),
        disabled: !waitsForActivation(user),
        linkNote: t('expires_in_days', { days: 7 }),
        run: send('send-activation'),
      }
}

// The links in core's copy block (the Git integration's), with whether the
// emails went out
function PasswordLinks({
  links,
  note,
}: {
  links: PasswordLink[]
  note?: string
}) {
  const { t } = useTranslation()
  return (
    <>
      {links.every(link => link.emailSent) ? (
        <p className="text-success mb-0" aria-live="polite">
          {t('email_sent')}
        </p>
      ) : (
        <OLNotification type="warning" content={t('no_email_sent_copy_link')} />
      )}
      {links.map(({ title, detail, link }, index) => (
        <div key={index}>
          {links.length > 1 && (
            <p className="admin-panel-modal-user mt-3 mb-0">
              <strong>{title}</strong>
              <span className="admin-panel-muted"> {detail}</span>
            </p>
          )}
          <div className="git-bridge-copy admin-panel-link justify-content-between align-items-start my-3">
            <code>{link}</code>
            <span>
              <CopyToClipboard
                content={link}
                tooltipId={`admin-user-copy-link-${index}`}
              />
            </span>
          </div>
        </div>
      ))}
      <p className="admin-panel-muted mb-0">{note}</p>
    </>
  )
}

// also used by the detail page's tabs (clear sessions, project actions);
// the subject is what the action is on: a user's name and email, a project
export function ConfirmModal({
  subject,
  subjects,
  action,
  onHide,
  onDone,
}: {
  subject?: { title: string; detail?: string }
  // a bulk action's rows, listed instead of one subject
  subjects?: { title: string; detail?: string }[]
  action: Action
  onHide: () => void
  onDone: () => void
}) {
  const { t } = useTranslation()
  const items = subjects ?? (subject ? [subject] : [])
  const { isLoading, isError, error, runAsync } = useAsync()
  const [sendEmail, setSendEmail] = useState(false)
  const [transfer, setTransfer] = useState(action.pickOwner === 'required')
  const [newOwner, setNewOwner] = useState<OwnerOption | null>(null)
  const [links, setLinks] = useState<PasswordLink[] | null>(null)
  const toUserId = transfer ? (newOwner?.id ?? null) : null

  const close = () => {
    onHide()
    onDone()
  }
  const confirm = () => {
    runAsync(action.run({ sendEmail, toUserId }))
      .then(result => {
        if (action.linkNote) {
          setLinks(result as PasswordLink[])
        } else {
          close()
        }
      })
      .catch(() => {})
  }

  return (
    <OLModal show onHide={links ? close : onHide} id={`admin-user-${action.key}-modal`}>
      <OLModalHeader>
        <OLModalTitle>{action.label}</OLModalTitle>
      </OLModalHeader>
      <OLModalBody>
        {action.intro && <p>{action.intro}</p>}
        {links && items.length > 1 ? null : items.length > 1 ? (
          <ul className="admin-panel-modal-list">
            {/* by place: projects of several owners can share a name */}
            {items.map((item, index) => (
              <li key={index}>
                <strong>{item.title}</strong>
                {item.detail && <span className="admin-panel-muted"> {item.detail}</span>}
              </li>
            ))}
          </ul>
        ) : (
          items.map(item => (
            <p key={item.title} className="admin-panel-modal-user">
              <strong>{item.title}</strong>
              {item.detail && <span className="admin-panel-muted"> {item.detail}</span>}
            </p>
          ))
        )}
        {links && <PasswordLinks links={links} note={action.linkNote} />}
        {action.warning && (
          <OLNotification type="warning" content={action.warning} />
        )}
        {action.key === 'delete' && (
          <OLFormCheckbox
            id="admin-user-delete-send-email"
            className="mt-3"
            checked={sendEmail}
            onChange={event => setSendEmail(event.target.checked)}
            label={t('notify_user_about_account_deletion')}
          />
        )}
        {action.pickOwner === 'optional' && (
          <OLFormCheckbox
            id={`admin-user-${action.key}-transfer`}
            className="mt-3"
            checked={transfer}
            onChange={event => setTransfer(event.target.checked)}
            label={t('transfer_this_users_projects')}
          />
        )}
        {transfer && (
          <div className="mt-3">
            <OwnerPicker
              value={newOwner}
              onChange={setNewOwner}
              excludeIds={action.ownerExcludeIds ?? []}
            />
          </div>
        )}
        {isError && (
          <OLNotification
            type="error"
            className="mt-3"
            content={
              // a bulk action lists the rows that failed; the others are done
              error instanceof BulkError ? (
                <ul className="mb-0 ps-3">
                  {error.failures.map((failure, index) => (
                    <li key={index}>
                      <strong>{failure.title}</strong>
                      {failure.message && `: ${failure.message}`}
                    </li>
                  ))}
                </ul>
              ) : (
                getUserFacingMessage(error) ?? t('generic_something_went_wrong')
              )
            }
          />
        )}
      </OLModalBody>
      <OLModalFooter>
        {links ? (
          <OLButton variant="secondary" onClick={close}>
            {t('close')}
          </OLButton>
        ) : (
          <>
            <OLButton variant="secondary" onClick={onHide} disabled={isLoading}>
              {t('cancel')}
            </OLButton>
            <OLButton
              variant={action.danger ? 'danger' : 'primary'}
              onClick={confirm}
              isLoading={isLoading}
              disabled={transfer && !newOwner}
            >
              {action.label}
            </OLButton>
          </>
        )}
      </OLModalFooter>
    </OLModal>
  )
}

function UserActions({
  user,
  onDone,
  onEdit,
  editDisabled,
}: {
  user: AdminUser
  onDone: (action: Action) => void
  // the detail page's pencil, which opens the account form
  onEdit?: () => void
  // greyed out on a form the admin cannot use: their own features
  editDisabled?: boolean
}) {
  const { t } = useTranslation()
  const { sessionUserId } = getOptions()
  const [open, setOpen] = useState<Action | null>(null)
  const isSelf = user.id === sessionUserId
  const url = `/admin/user/${user.id}`

  const actions: Action[] = []
  if (user.deleted) {
    actions.push(
      {
        key: 'restore',
        icon: 'restore',
        label: t('restore'),
        intro: t('about_to_restore_accounts'),
        run: () => postJSON(`${url}/restore`),
      },
      {
        key: 'purge',
        icon: 'delete_forever',
        label: t('delete_permanently'),
        danger: true,
        intro: t('about_to_permanently_delete_accounts'),
        warning: t('this_action_cannot_be_undone'),
        run: () => deleteJSON(url),
      }
    )
  } else {
    actions.push(
      passwordLinkAction(t, user),
      {
        key: 'transfer',
        icon: 'drive_file_move',
        label: t('transfer_this_users_projects'),
        intro: t('their_projects_will_be_transferred_to_another_user'),
        pickOwner: 'required',
        ownerExcludeIds: [user.id],
        run: ({ toUserId }) =>
          postJSON(`${url}/transfer-projects`, { body: { toUserId } }),
      },
      user.suspended
        ? {
            key: 'resume',
            icon: 'play_circle',
            label: t('enable'),
            run: () => postJSON(`${url}/update`, { body: { suspended: false } }),
          }
        : {
            key: 'suspend',
            icon: 'block',
            label: t('disable'),
            danger: true,
            run: () => postJSON(`${url}/update`, { body: { suspended: true } }),
          },
      {
        key: 'delete',
        icon: 'delete',
        label: t('delete_account'),
        danger: true,
        // the endpoint transfers the projects first when given a user
        pickOwner: 'optional',
        ownerExcludeIds: [user.id],
        run: ({ sendEmail, toUserId }) =>
          postJSON(`${url}/delete`, { body: { sendEmail, toUserId } }),
      }
    )
  }

  // The own account cannot be disabled or deleted (the endpoints refuse it
  // too): its actions show greyed out and cannot be clicked, so the same
  // icon still lines up in every row.
  const disableActions = isSelf && !user.deleted

  return (
    <div className="admin-panel-actions">
      {/* the own name, email and password can be edited, so the pencil is
          never hidden */}
      {onEdit && !user.deleted && (
        <OLTooltip
          id={`admin-user-edit-${user.id}`}
          description={t('edit')}
          overlayProps={{ placement: 'top' }}
        >
          <OLIconButton
            variant="ghost"
            size="sm"
            icon="edit"
            accessibilityLabel={t('edit')}
            className="action-btn"
            disabled={editDisabled}
            onClick={onEdit}
          />
        </OLTooltip>
      )}
      {actions.map(action =>
        disableActions || action.disabled ? (
          <OLIconButton
            key={action.key}
            variant="ghost"
            size="sm"
            icon={action.icon}
            accessibilityLabel={action.label}
            className="action-btn"
            disabled
          />
        ) : (
        <OLTooltip
          key={action.key}
          id={`admin-user-${action.key}-${user.id}`}
          description={action.label}
          overlayProps={{ placement: 'top' }}
        >
          <OLIconButton
            variant="ghost"
            size="sm"
            icon={action.icon}
            accessibilityLabel={action.label}
            className={classnames('action-btn', {
              'admin-panel-action-danger': action.danger,
            })}
            onClick={() => setOpen(action)}
          />
        </OLTooltip>
        )
      )}
      {open && (
        <ConfirmModal
          subject={userSubject(user)}
          action={open}
          onHide={() => setOpen(null)}
          onDone={() => onDone(open)}
        />
      )}
    </div>
  )
}

export function CreateUserButton({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation()
  const { enabledAuth } = getOptions()
  const [show, setShow] = useState(false)
  const [form, setForm] = useState({
    email: '',
    firstName: '',
    lastName: '',
    isAdmin: false,
    isExternal: false,
  })
  const { isLoading, isError, error, runAsync, reset } = useAsync()
  const hasExternalAuth = enabledAuth.ldap || enabledAuth.saml || enabledAuth.oidc

  const close = () => {
    setShow(false)
    reset()
  }
  const create = () => {
    runAsync(
      postJSON('/admin/user/create', {
        body: {
          email: form.email.trim(),
          first_name: form.firstName.trim(),
          last_name: form.lastName.trim(),
          isAdmin: form.isAdmin,
          isExternal: form.isExternal,
        },
      })
    )
      .then(() => {
        close()
        setForm({ email: '', firstName: '', lastName: '', isAdmin: false, isExternal: false })
        onDone()
      })
      .catch(() => {})
  }
  const field = (name: 'email' | 'firstName' | 'lastName', label: string): ReactNode => (
    <OLFormGroup controlId={`admin-create-${name}`}>
      <OLFormLabel>{label}</OLFormLabel>
      <OLFormControl
        type={name === 'email' ? 'email' : 'text'}
        value={form[name]}
        required={name === 'email'}
        onChange={event => setForm({ ...form, [name]: event.target.value })}
      />
    </OLFormGroup>
  )

  return (
    <>
      {/* on narrow screens the button shrinks to its icon */}
      <OLButton
        variant="primary"
        leadingIcon="person_add"
        className="d-none d-md-inline-flex"
        onClick={() => setShow(true)}
      >
        {t('create_account')}
      </OLButton>
      <OLTooltip
        id="admin-create-user-icon"
        description={t('create_account')}
        overlayProps={{ placement: 'bottom' }}
      >
        <OLIconButton
          variant="primary"
          icon="person_add"
          accessibilityLabel={t('create_account')}
          className="d-md-none rounded-circle"
          onClick={() => setShow(true)}
        />
      </OLTooltip>
      {show && (
        <OLModal show onHide={close} id="admin-create-user-modal">
          <OLModalHeader>
            <OLModalTitle>{t('create_account')}</OLModalTitle>
          </OLModalHeader>
          <OLModalBody>
            {field('email', t('email_address'))}
            {field('firstName', t('first_name'))}
            {field('lastName', t('last_name'))}
            <OLFormCheckbox
              id="admin-create-is-admin"
              checked={form.isAdmin}
              onChange={event => setForm({ ...form, isAdmin: event.target.checked })}
              label={t('admin_titlecase')}
            />
            {hasExternalAuth && (
              <OLFormCheckbox
                id="admin-create-is-external"
                checked={form.isExternal}
                onChange={event =>
                  setForm({ ...form, isExternal: event.target.checked })
                }
                label={t('log_in_with_sso')}
              />
            )}
            {isError && (
              <OLNotification
                type="error"
                className="mt-3"
                content={getUserFacingMessage(error) ?? t('generic_something_went_wrong')}
              />
            )}
          </OLModalBody>
          <OLModalFooter>
            <OLButton variant="secondary" onClick={close} disabled={isLoading}>
              {t('cancel')}
            </OLButton>
            <OLButton
              variant="primary"
              onClick={create}
              isLoading={isLoading}
              disabled={!form.email.trim()}
            >
              {t('create')}
            </OLButton>
          </OLModalFooter>
        </OLModal>
      )}
    </>
  )
}

export default UserActions
