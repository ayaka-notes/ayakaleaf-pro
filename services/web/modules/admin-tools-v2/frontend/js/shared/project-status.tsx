import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { deleteJSON, postJSON } from '@/infrastructure/fetch-json'
import type { Action } from '../admin-users/components/user-actions'

// A project's status for its owner: archived and trashed are the owner's
// own marks; deleted ones are in deletedProjects
export type ProjectStatus = 'active' | 'archived' | 'trashed' | 'deleted'

const BADGE: Record<ProjectStatus, string> = {
  active: 'admin-panel-badge-positive',
  archived: '',
  trashed: 'admin-panel-badge-saml',
  deleted: 'admin-panel-badge-danger',
}

export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  const { t } = useTranslation()
  // spelled out, so extract-translations finds the keys
  const labels: Record<ProjectStatus, string> = {
    active: t('active'),
    archived: t('archived'),
    trashed: t('trashed'),
    deleted: t('deleted'),
  }
  return (
    <span className={`admin-panel-badge ${BADGE[status]}`}>
      {labels[status]}
    </span>
  )
}

// a project is deleted first (core's delete, kept
// in deletedProjects until it expires), then restored or purged there; the
// Projects tab and the project page offer the same actions
export function projectActions(
  t: TFunction,
  project: { id: string; status: ProjectStatus },
  ownerId: string
): Action[] {
  return project.status === 'deleted'
    ? [
        {
          key: 'project-restore',
          icon: 'restore',
          label: t('restore'),
          intro: t('about_to_restore_projects'),
          run: () =>
            postJSON(`/admin/project/${project.id}/undelete`, {
              body: { userId: ownerId },
            }),
        },
        {
          key: 'project-purge',
          icon: 'delete_forever',
          label: t('delete_permanently'),
          danger: true,
          intro: t('about_to_delete_projects'),
          warning: t('this_action_cannot_be_undone'),
          run: () => deleteJSON(`/admin/project/${project.id}/purge`),
        },
      ]
    : [
        {
          key: 'project-delete',
          icon: 'delete',
          label: t('delete'),
          danger: true,
          intro: t('about_to_delete_projects'),
          run: () => deleteJSON(`/project/${project.id}`),
        },
      ]
}

// core's transfer, as the share modal's "make owner": an admin may pick any
// user of the site, not only a collaborator; the Projects tab's rows and the
// project page's overview offer it
export function changeOwnerAction(
  t: TFunction,
  projectId: string,
  ownerId?: string
): Action {
  return {
    key: 'change-owner',
    icon: 'drive_file_move',
    label: t('change_project_owner'),
    pickOwner: 'required',
    ownerExcludeIds: ownerId ? [ownerId] : [],
    warning: t('project_ownership_transfer_confirmation_2'),
    run: ({ toUserId }) =>
      postJSON(`/project/${projectId}/transfer-ownership`, {
        body: { user_id: toUserId },
      }),
  }
}
