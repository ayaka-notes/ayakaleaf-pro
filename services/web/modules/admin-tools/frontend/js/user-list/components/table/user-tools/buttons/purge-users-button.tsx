import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import OLButton from '@/shared/components/ol/ol-button'
import useIsMounted from '@/shared/hooks/use-is-mounted'
import { useUserListContext } from '../../../../context/user-list-context'
import { User } from '../../../../../../../types/user/api'
import PurgeUserModal from '../../../modals/purge-user-modal'
import { performPurgeUser, type PostActions } from '../../../../util/user-actions'

function PurgeUsersButton() {
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

  const { selectedUsers, removeUserFromView } = useUserListContext()
  const postActions: PostActions = { removeUserFromView }

  const handlePurgeUser = (user: User) => {
    return performPurgeUser(user, postActions)
  }

  return (
    <>
      <OLButton variant="danger" onClick={handleOpenModal}>
        {t('purge')}
      </OLButton>

      <PurgeUserModal
        users={selectedUsers}
        actionHandler={handlePurgeUser}
        showModal={showModal}
        handleCloseModal={handleCloseModal}
      />
    </>
  )
}

export default PurgeUsersButton
