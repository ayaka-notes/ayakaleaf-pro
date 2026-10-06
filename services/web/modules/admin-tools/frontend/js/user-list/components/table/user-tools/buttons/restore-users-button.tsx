import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import OLButton from '@/shared/components/ol/ol-button'
import useIsMounted from '@/shared/hooks/use-is-mounted'
import { useUserListContext } from '../../../../context/user-list-context'
import { User } from '../../../../../../../types/user/api'
import RestoreUserModal from '../../../modals/restore-user-modal'
import { performRestoreUser, type PostActions } from '../../../../util/user-actions'

function RestoreUsersButton() {
  const { t } = useTranslation()
  const [showModal, setShowModal] = useState(false)
  const isMounted = useIsMounted()

  const handleOpenModal = () => {
    setShowModal(true)
  }
  const handleCloseModal = () => {
    if (isMounted.current) {
      setShowModal(false)
    }
  }

  const { selectedUsers, toggleSelectedUser, updateUserViewData } = useUserListContext()
  const postActions: PostActions = { toggleSelectedUser, updateUserViewData }

  const handleRestoreUser = (user: User) => {
    return performRestoreUser(user, postActions)
  }

  return (
    <>
      <OLButton variant="primary" onClick={handleOpenModal}>
        {t('restore')}
      </OLButton>

      <RestoreUserModal
        users={selectedUsers}
        actionHandler={handleRestoreUser}
        showModal={showModal}
        handleCloseModal={handleCloseModal}
      />
    </>
  )
}

export default RestoreUsersButton
