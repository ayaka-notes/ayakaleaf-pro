import { useTranslation } from 'react-i18next'
import getMeta from '@/utils/meta'
import {
  OLDropdown as Dropdown,
  OLDropdownItem as DropdownItem,
  OLDropdownMenu as DropdownMenu,
  OLDropdownToggle as DropdownToggle,
} from '@/shared/components/ol/ol-dropdown-menu'
import MaterialIcon from '@/shared/components/material-icon'
import OLSpinner from '@/shared/components/ol/ol-spinner'
import FlagUserButton from '../table/cells/action-buttons/flag-user-button'
import DeleteUserButton from '../table/cells/action-buttons/delete-user-button'
import UpdateUserButton from '../table/cells/action-buttons/update-user-button'
import RestoreUserButton from '../table/cells/action-buttons/restore-user-button'
import PurgeUserButton from '../table/cells/action-buttons/purge-user-button'
import ShowUserInfoButton from '../table/cells/action-buttons/show-user-info-button'
import SendRegEmailButton from '../table/cells/action-buttons/send-reg-email-button'
import { User } from '../../../../../types/user/api'

const flagActions = [
  { action: 'suspend', icon: 'pause', unfilled: false },
  { action: 'resume', icon: 'resume', unfilled: false },
]

type ActionDropdownProps = {
  user: User
}

function ActionsDropdown({ user }: ActionDropdownProps) {
  const { t } = useTranslation()
  const isSelf = getMeta('ol-user_id') === user.id

  return (
    <Dropdown align="end">
      <DropdownToggle
        id={`user-actions-dropdown-toggle-btn-${user.id}`}
        bsPrefix="dropdown-table-button-toggle"
      >
        <MaterialIcon type="more_vert" accessibilityLabel={t('actions')} />
      </DropdownToggle>
      <DropdownMenu flip={false}>
        <ShowUserInfoButton user={user}>
          {(text, handleOpenModal) => (
            <li role="none">
              <DropdownItem
                as="button"
                tabIndex={-1}
                onClick={handleOpenModal}
                leadingIcon="info"
                unfilled={true}
              >
                {text}
              </DropdownItem>
            </li>
          )}
        </ShowUserInfoButton>
        <UpdateUserButton user={user}>
          {(text, handleOpenModal) => (
            <li role="none">
              <DropdownItem
                as="button"
                tabIndex={-1}
                onClick={handleOpenModal}
                leadingIcon="edit"
                unfilled={true}
              >
                {text}
              </DropdownItem>
            </li>
          )}
        </UpdateUserButton>
        {!isSelf && (
          <>
            {flagActions.map(({ action, icon, unfilled }) => (
              <FlagUserButton key={action} user={user} action={action}>
                {(text, handleOpenModal) => (
                  <li role="none">
                    <DropdownItem
                      as="button"
                      tabIndex={-1}
                      onClick={handleOpenModal}
                      leadingIcon={icon}
                      unfilled={unfilled}
                    >
                      {text}
                    </DropdownItem>
                  </li>
                )}
              </FlagUserButton>
            ))}

            <DeleteUserButton user={user}>
              {(text, handleOpenModal) => (
                <li role="none">
                  <DropdownItem
                    as="button"
                    tabIndex={-1}
                    onClick={handleOpenModal}
                    leadingIcon="delete"
                    unfilled
                  >
                    {text}
                  </DropdownItem>
                </li>
              )}
            </DeleteUserButton>

            <RestoreUserButton user={user}>
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
            </RestoreUserButton>

            <PurgeUserButton user={user}>
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
            </PurgeUserButton>
            {(user.authMethods.includes('local') && !user.suspended) && ( 
              <SendRegEmailButton user={user}>
                {(text, handleOpenModal) => (
                  <li role="none">
                    <DropdownItem
                      as="button"
                      tabIndex={-1}
                      onClick={handleOpenModal}
                      leadingIcon="mail"
                      unfilled
                    >
                      {text}
                    </DropdownItem>
                  </li>
                )}
              </SendRegEmailButton>
            )}
          </>
        )}
      </DropdownMenu>
    </Dropdown>
  )
}

export default ActionsDropdown
