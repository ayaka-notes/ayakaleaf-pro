import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  deleteJSON,
  getUserFacingMessage,
  postJSON,
  putJSON,
} from '@/infrastructure/fetch-json'
import useAsync from '@/shared/hooks/use-async'
import OLTable, { TableContainer } from '@/shared/components/ol/ol-table'
import OLButton from '@/shared/components/ol/ol-button'
import OLFormSelect from '@/shared/components/ol/ol-form-select'
import OLIconButton from '@/shared/components/ol/ol-icon-button'
import OLTooltip from '@/shared/components/ol/ol-tooltip'
import OLNotification from '@/shared/components/notification'
import { ConfirmModal, type Action } from '../../admin-users/components/user-actions'
import { getAdminProject } from '../meta'
import type { AdminProjectMeta } from '../types'

type Member = NonNullable<AdminProjectMeta['members']>[number]
type Invite = NonNullable<AdminProjectMeta['invites']>[number]

// the share modal's roles for an invited collaborator
const ROLES = ['readAndWrite', 'review', 'readOnly'] as const

// Everyone with access as core lists them (owner, invited collaborators,
// link-sharing users), then the invites nobody has accepted yet. The
// header's pencil manages them as the share modal does, through core's own
// endpoints, each change applied at once: a collaborator's role, removing
// access, resending or revoking an invite. The owner is changed on the
// overview.
function MembersTab({
  editing,
  onEditingChange,
}: {
  editing: boolean
  onEditingChange: (editing: boolean) => void
}) {
  const { t } = useTranslation()
  const meta = getAdminProject()
  const projectId = meta.project.id
  const [members, setMembers] = useState<Member[]>(meta.members ?? [])
  const [invites, setInvites] = useState<Invite[]>(meta.invites ?? [])
  const [open, setOpen] = useState<{ action: Action; title: string; detail?: string } | null>(null)
  const roleChange = useAsync()

  const roles: Record<string, string> = {
    owner: t('owner'),
    readAndWrite: t('editor'),
    readOnly: t('viewer'),
    review: t('reviewer'),
  }

  const setRole = (member: Member, privilegeLevel: string) => {
    roleChange
      .runAsync(
        putJSON(`/project/${projectId}/users/${member.id}`, {
          body: { privilegeLevel },
        })
      )
      .then(() =>
        setMembers(prev =>
          prev.map(m =>
            m.id === member.id && m.source === 'invite'
              ? { ...m, privilegeLevel: privilegeLevel as Member['privilegeLevel'] }
              : m
          )
        )
      )
      .catch(() => {})
  }

  const nameOf = (member: Member) =>
    [member.firstName, member.lastName].filter(Boolean).join(' ')

  const removeMember = (member: Member): Action => ({
    key: 'member-remove',
    icon: 'delete',
    label: t('remove_access'),
    danger: true,
    run: () =>
      deleteJSON(`/project/${projectId}/users/${member.id}`).then(() =>
        setMembers(prev => prev.filter(m => m.id !== member.id))
      ),
  })
  const resendInvite = (invite: Invite): Action => ({
    key: 'invite-resend',
    icon: 'mail',
    label: t('resend_invite'),
    run: () => postJSON(`/project/${projectId}/invite/${invite.id}/resend`),
  })
  const revokeInvite = (invite: Invite): Action => ({
    key: 'invite-revoke',
    icon: 'delete',
    label: t('revoke_invite'),
    danger: true,
    run: () =>
      deleteJSON(`/project/${projectId}/invite/${invite.id}`).then(() =>
        setInvites(prev => prev.filter(i => i.id !== invite.id))
      ),
  })

  const actionButton = (
    id: string,
    action: Action,
    title: string,
    detail?: string
  ) => (
    <OLTooltip
      key={action.key}
      id={`admin-${action.key}-${id}`}
      description={action.label}
      overlayProps={{ placement: 'top' }}
    >
      <OLIconButton
        variant="ghost"
        size="sm"
        icon={action.icon}
        className={
          action.danger ? 'action-btn admin-panel-action-danger' : 'action-btn'
        }
        accessibilityLabel={action.label}
        onClick={() => setOpen({ action, title, detail })}
      />
    </OLTooltip>
  )

  return (
    <>
      <TableContainer bordered>
        <OLTable container={false} className="admin-panel-table">
          <thead>
            <tr>
              <th scope="col">{t('name')}</th>
              <th scope="col">{t('role')}</th>
              {editing && (
                <th scope="col" className="admin-panel-cell-actions">
                  {t('actions')}
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {members.map(member => {
              const name = nameOf(member)
              const isOwner = member.source === 'owner'
              return (
                <tr key={`${member.id}-${member.source}`}>
                  <td className="admin-panel-cell-user">
                    <div className="admin-panel-user-name">
                      <a href={`/admin/user/${member.id}`}>
                        {name || member.email || member.id}
                      </a>
                      {member.source === 'token' && (
                        <span className="admin-panel-badge">
                          {t('link_sharing')}
                        </span>
                      )}
                    </div>
                    {name && <div className="admin-panel-muted">{member.email}</div>}
                  </td>
                  <td>
                    {/* link-sharing users get the link's role; only invited
                        collaborators have one to change */}
                    {editing && member.source === 'invite' ? (
                      <OLFormSelect
                        id={`admin-member-role-${member.id}`}
                        className="admin-panel-input-role"
                        size="sm"
                        value={member.privilegeLevel}
                        disabled={roleChange.isLoading}
                        onChange={event => setRole(member, event.target.value)}
                      >
                        {ROLES.map(role => (
                          <option key={role} value={role}>
                            {roles[role]}
                          </option>
                        ))}
                      </OLFormSelect>
                    ) : (
                      roles[member.privilegeLevel] ?? member.privilegeLevel
                    )}
                  </td>
                  {editing && (
                    <td className="admin-panel-cell-actions">
                      <div className="admin-panel-actions">
                        {!isOwner &&
                          actionButton(
                            member.id,
                            removeMember(member),
                            name || member.email || member.id,
                            name ? member.email : undefined
                          )}
                      </div>
                    </td>
                  )}
                </tr>
              )
            })}
            {invites.map(invite => (
              <tr key={invite.id}>
                <td className="admin-panel-cell-user">
                  <div className="admin-panel-user-name">
                    {invite.email}
                    <span className="admin-panel-badge">
                      {t('pending_invite')}
                    </span>
                  </div>
                </td>
                <td>{roles[invite.privilegeLevel] ?? invite.privilegeLevel}</td>
                {editing && (
                  <td className="admin-panel-cell-actions">
                    <div className="admin-panel-actions">
                      {actionButton(invite.id, resendInvite(invite), invite.email)}
                      {actionButton(invite.id, revokeInvite(invite), invite.email)}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </OLTable>
      </TableContainer>
      {roleChange.isError && (
        <OLNotification
          type="error"
          className="mt-3"
          content={
            getUserFacingMessage(roleChange.error) ?? t('generic_something_went_wrong')
          }
        />
      )}
      {/* every change is already applied, so the form only closes */}
      {editing && (
        <div className="admin-panel-form-actions">
          <OLButton
            variant="secondary"
            onClick={() => {
              roleChange.reset()
              onEditingChange(false)
            }}
          >
            {t('done')}
          </OLButton>
        </div>
      )}
      {open && (
        <ConfirmModal
          subject={{ title: open.title, detail: open.detail }}
          action={open.action}
          onHide={() => setOpen(null)}
          onDone={() => {}}
        />
      )}
    </>
  )
}

export default MembersTab
