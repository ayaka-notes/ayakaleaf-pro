import { useTranslation } from 'react-i18next'
import {
  OLDropdown as Dropdown,
  OLDropdownItem as DropdownItem,
  OLDropdownMenu as DropdownMenu,
  OLDropdownToggle as DropdownToggle,
} from '@/shared/components/ol/ol-dropdown-menu'
import DownloadProjectButton from '../table/cells/action-buttons/download-project-button'
import TrashProjectButton from '../table/cells/action-buttons/trash-project-button'
import UntrashProjectButton from '../table/cells/action-buttons/untrash-project-button'
import DeleteProjectButton from '../table/cells/action-buttons/delete-project-button'
import RestoreProjectButton from '../table/cells/action-buttons/restore-project-button'
import PurgeProjectButton from '../table/cells/action-buttons/purge-project-button'
import TransferProjectButton from '../table/cells/action-buttons/transfer-project-button'
import { Project } from '../../../../../types/project/api'
import MaterialIcon from '@/shared/components/material-icon'
import OLSpinner from '@/shared/components/ol/ol-spinner'

type ActionDropdownProps = {
  project: Project
}

function ActionsDropdown({ project }: ActionDropdownProps) {
  const { t } = useTranslation()

  return (
    <Dropdown align="end">
      <DropdownToggle
        id={`project-actions-dropdown-toggle-btn-${project.id}`}
        bsPrefix="dropdown-table-button-toggle"
      >
        <MaterialIcon type="more_vert" accessibilityLabel={t('actions')} />
      </DropdownToggle>
      <DropdownMenu flip={false}>
        <DownloadProjectButton project={project}>
          {(text, downloadProject) => (
            <li role="none">
              <DropdownItem
                as="button"
                tabIndex={-1}
                onClick={downloadProject}
                leadingIcon="download"
              >
                {text}
              </DropdownItem>
            </li>
          )}
        </DownloadProjectButton>
        <TransferProjectButton project={project}>
          {(text, handleOpenModal) => (
            <li role="none">
              <DropdownItem
                as="button"
                tabIndex={-1}
                onClick={handleOpenModal}
                leadingIcon="swap_horiz"
              >
                {text}
              </DropdownItem>
            </li>
          )}
        </TransferProjectButton>
        <TrashProjectButton project={project}>
          {(text, handleOpenModal) => (
            <li role="none">
              <DropdownItem
                as="button"
                tabIndex={-1}
                onClick={handleOpenModal}
                leadingIcon="delete"
              >
                {text}
              </DropdownItem>
            </li>
          )}
        </TrashProjectButton>
        <UntrashProjectButton project={project}>
          {(text, untrashProject) => (
            <li role="none">
              <DropdownItem
                as="button"
                tabIndex={-1}
                onClick={untrashProject}
                leadingIcon="restore_page"
              >
                {text}
              </DropdownItem>
            </li>
          )}
        </UntrashProjectButton>
        <DeleteProjectButton project={project}>
          {(text, handleOpenModal) => (
            <li role="none">
              <DropdownItem
                as="button"
                tabIndex={-1}
                onClick={handleOpenModal}
                leadingIcon="block"
              >
                {text}
              </DropdownItem>
            </li>
          )}
        </DeleteProjectButton>
        <RestoreProjectButton project={project}>
          {(text, handleOpenModal) => (
            <li role="none">
              <DropdownItem
                as="button"
                tabIndex={-1}
                onClick={handleOpenModal}
                leadingIcon="restore"
              >
                {text}
              </DropdownItem>
            </li>
          )}
        </RestoreProjectButton>
        <PurgeProjectButton project={project}>
          {(text, handleOpenModal) => (
            <li role="none">
              <DropdownItem
                as="button"
                tabIndex={-1}
                onClick={handleOpenModal}
                leadingIcon="delete_forever"
              >
                {text}
              </DropdownItem>
            </li>
          )}
        </PurgeProjectButton>






      </DropdownMenu>
    </Dropdown>
  )
}

export default ActionsDropdown
