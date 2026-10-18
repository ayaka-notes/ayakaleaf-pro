import { useMemo, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ProjectsActionModal from './projects-action-modal'
import ProjectsList from './projects-list'
import SelectOwnerForm from '../select-owner-form'
import { useUserListContext } from '../../../user-list/context/user-list-context'
import { useProjectListContext } from '../../context/project-list-context'
import OLForm from '@/shared/components/ol/ol-form'
import OLFormGroup from '@/shared/components/ol/ol-form-group'
import sortUsers from '../../../user-list/util/sort-users'

type TransferProjectModalProps = Pick<
  React.ComponentProps<typeof ProjectsActionModal>,
  'projects' | 'actionHandler' | 'showModal' | 'handleCloseModal'
>

function TransferProjectModal({
  projects,
  actionHandler,
  showModal,
  handleCloseModal,
}: TransferProjectModalProps) {
  const { t } = useTranslation()
  const [projectsToDisplay, setProjectsToDisplay] = useState<typeof projects>(
    []
  )
  const { loadedUsers } = useUserListContext()
  const { projectsOwnerId } = useProjectListContext()

  const potentialOwners = useMemo(() => {
    if (!loadedUsers) return null;
    const sortedUsers = sortUsers(loadedUsers, { by: 'name', order: 'asc' })
    const result: UserRef[] = []
    for (const user of sortedUsers) {
      if (!user.deleted && user.id !== projectsOwnerId) {
        result.push({
          id: user.id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email
        })
      }
    }
    return result
  }, [loadedUsers, projectsOwnerId])

  const [newOwner, setNewOwner] = useState<UserRef | null>(null)

  const options = useMemo(() => {
    if (!newOwner) return null

    return {
      user_id: newOwner.id,
    }
  }, [newOwner])

  useEffect(() => {
    if (showModal) {
      setNewOwner(null)
    }
  }, [showModal])

  useEffect(() => {
    if (showModal) {
      setProjectsToDisplay(displayProjects => {
        return displayProjects.length ? displayProjects : projects
      })
    } else {
      setProjectsToDisplay([])
    }
  }, [showModal, projects])

  return (
    <ProjectsActionModal
      action="transfer"
      actionHandler={actionHandler}
      title={t('change_project_owner')}
      showModal={showModal}
      handleCloseModal={handleCloseModal}
      projects={projects}
      options={options}
      actionIsDisabled={!newOwner}
    >
      <p>{t('their_projects_will_be_transferred_to_another_user')}</p>
      <ProjectsList projects={projects} projectsToDisplay={projectsToDisplay} />

      <OLForm className="add-collabs">
        <OLFormGroup>
          <SelectOwnerForm
            loading={!potentialOwners}
            users={potentialOwners || []}
            value={newOwner}
            onChange={setNewOwner}
          />
        </OLFormGroup>
      </OLForm>
    </ProjectsActionModal>
  )
}

export default TransferProjectModal
