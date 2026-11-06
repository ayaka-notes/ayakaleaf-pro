import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { deleteJSON, postJSON } from '@/infrastructure/fetch-json'
import OLIconButton from '@/shared/components/ol/ol-icon-button'
import OLTooltip from '@/shared/components/ol/ol-tooltip'
import OLButtonGroup from '@/shared/components/ol/ol-button-group'
import OLButtonToolbar from '@/shared/components/ol/ol-button-toolbar'
import { runEach } from '../../shared/selection'
import type { AdminUser } from '../types'
import { ConfirmModal, userSubject, type Action } from './user-actions'

type BulkAction = Omit<Action, 'run'> & {
  each: (
    user: AdminUser,
    options: { sendEmail: boolean; toUserId: string | null }
  ) => Promise<unknown>
}

// The bulk actions on the ticked users (the toolbar: disable,
// enable, registration emails, admin on and off, delete; restore and purge
// for deleted users), plus moving their projects like the row action. Each
// runs the endpoint of one user on every ticked user in turn.
function UsersBulkActions({
  users,
  deleted,
  onDone,
}: {
  users: AdminUser[]
  // the deleted users' list offers restore and purge instead
  deleted: boolean
  onDone: () => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState<BulkAction | null>(null)
  // whether the open modal ran its action: a cancel keeps the ticks
  const ran = useRef(false)
  const ids = users.map(user => user.id)
  const update = (user: AdminUser, body: Record<string, unknown>) =>
    postJSON(`/admin/user/${user.id}/update`, { body })

  const actions: BulkAction[] = deleted
    ? [
        {
          key: 'restore',
          icon: 'restore',
          label: t('restore'),
          intro: t('about_to_restore_accounts'),
          each: user => postJSON(`/admin/user/${user.id}/restore`),
        },
        {
          key: 'purge',
          icon: 'delete_forever',
          label: t('delete_permanently'),
          danger: true,
          intro: t('about_to_permanently_delete_accounts'),
          warning: t('this_action_cannot_be_undone'),
          each: user => deleteJSON(`/admin/user/${user.id}`),
        },
      ]
    : [
        {
          key: 'resend',
          icon: 'mail',
          label: t('resend'),
          each: user => postJSON(`/admin/user/${user.id}/send-activation`),
        },
        {
          key: 'transfer',
          icon: 'drive_file_move',
          label: t('transfer_this_users_projects'),
          intro: t('their_projects_will_be_transferred_to_another_user'),
          pickOwner: 'required',
          ownerExcludeIds: ids,
          each: (user, { toUserId }) =>
            postJSON(`/admin/user/${user.id}/transfer-projects`, {
              body: { toUserId },
            }),
        },
        {
          key: 'suspend',
          icon: 'block',
          label: t('disable'),
          danger: true,
          each: user => update(user, { suspended: true }),
        },
        {
          key: 'resume',
          icon: 'play_circle',
          label: t('enable'),
          each: user => update(user, { suspended: false }),
        },
        {
          key: 'set-admin',
          icon: 'add_moderator',
          label: t('set_admin'),
          each: user => update(user, { isAdmin: true }),
        },
        {
          key: 'unset-admin',
          icon: 'remove_moderator',
          label: t('unset_admin'),
          each: user => update(user, { isAdmin: false }),
        },
        {
          // the key the confirm modal adds the email checkbox for
          key: 'delete',
          icon: 'delete',
          label: t('delete_account'),
          danger: true,
          pickOwner: 'optional',
          ownerExcludeIds: ids,
          each: (user, { sendEmail, toUserId }) =>
            postJSON(`/admin/user/${user.id}/delete`, {
              body: { sendEmail, toUserId },
            }),
        },
      ]

  if (users.length === 0) return null

  // core's project tools: groups of secondary icon buttons with tooltips
  const groups = deleted
    ? [['restore'], ['purge']]
    : [['resend', 'transfer'], ['suspend', 'resume'], ['set-admin', 'unset-admin'], ['delete']]

  return (
    <OLButtonToolbar aria-label={t('actions')} className="admin-panel-bulk-actions">
      {groups.map(keys => (
        <OLButtonGroup key={keys.join('-')}>
          {actions
            .filter(action => keys.includes(action.key))
            .map(action => (
              <OLTooltip
                key={action.key}
                id={`admin-users-bulk-${action.key}`}
                description={action.label}
                overlayProps={{ placement: 'bottom', trigger: ['hover', 'focus'] }}
              >
                <OLIconButton
                  variant="secondary"
                  icon={action.icon}
                  accessibilityLabel={action.label}
                  onClick={() => setOpen(action)}
                />
              </OLTooltip>
            ))}
        </OLButtonGroup>
      ))}
      {open && (
        <ConfirmModal
          subjects={users.map(userSubject)}
          action={{
            ...open,
            run: options => {
              ran.current = true
              return runEach(users, user => user.email, user => open.each(user, options))
            },
          }}
          // what was done stays done when some rows failed: the list reloads
          onHide={() => {
            setOpen(null)
            if (ran.current) onDone()
            ran.current = false
          }}
          onDone={() => {}}
        />
      )}
    </OLButtonToolbar>
  )
}

export default UsersBulkActions
