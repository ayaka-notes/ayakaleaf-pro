import OLButton from '@/shared/components/ol/ol-button'
import Button from '@/shared/components/ol/ol-button'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { sendMB } from '@/infrastructure/event-tracking'
import { useSendUserListMB } from './user-list-events'
import CreateAccountModal from './create-account-button/create-account-modal'

type Segmentation = {
  action: string
}

type CreateAccountButtonProps = {
  id: string
  buttonText?: string
  className?: string
  trackingKey?: string
}

function CreateAccountButton({
  id,
  buttonText,
  className,
  trackingKey,
}: CreateAccountButtonProps) {
  const { t } = useTranslation()
  const [showModal, setShowModal] = useState(false)
  const sendUserListMB = useSendUserListMB()

  const handleButtonClick = useCallback(() => {
    if (trackingKey) {
      const segmentation: Segmentation = {
        action: 'create-account-click',
      }
      sendMB(trackingKey, segmentation)
    }

    sendUserListMB('create-account-click')
    setShowModal(true)
  }, [sendUserListMB, trackingKey])

  return (
    <div className="create-account-button-wrapper">
        <OLButton
          id={id}
          className="create-account-button"
          variant="primary"
          onClick={handleButtonClick}
        >
          {buttonText || t('create_account')}
        </OLButton>

      {showModal && (
        <CreateAccountModal onHide={() => setShowModal(false)} />
      )}
    </div>
  )
}

export default CreateAccountButton

