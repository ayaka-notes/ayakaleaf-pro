import { deleteJSON } from '@/infrastructure/fetch-json'
import { useState, memo } from 'react'
import { Button } from 'react-bootstrap'
import { useTranslation } from 'react-i18next'
import {
  OLModal,
  OLModalBody,
  OLModalFooter,
  OLModalHeader,
  OLModalTitle,
} from '@/shared/components/ol/ol-modal'

type Props = {
    handleHide: () => void
    tokenId: string
}

// Modal 开头的函数名是Modal的内容、函数逻辑
function ModalDeleteAuthenticationToken({ handleHide, tokenId }: Props) {
    const { t } = useTranslation()
    const [isDeleting, setIsDeleting] = useState(false)
    const [isError, setIsError] = useState(false)

    const deleteToken = () => {
        setIsDeleting(true)
        setIsError(false)
        deleteJSON('/oauth/personal-access-tokens/' + tokenId, {
            body: {
                _csrf: window.csrfToken,
                tokenId,
            },
        })
            .then(() => {
                // location.reload()
                handleHide()
            })
            .catch(() => {
                setIsError(true)
                setIsDeleting(false)
            })
    }

    return (
        <>
            <OLModalHeader>
                <OLModalTitle>{t('delete_authentication_token')}</OLModalTitle>
            </OLModalHeader>

            <OLModalBody>
                <p>{t('delete_authentication_token_info')}</p>
            </OLModalBody>

            <OLModalFooter>
                <Button
                    onClick={handleHide}
                    disabled={isDeleting}
                    variant="secondary"
                >
                    {t('cancel')}
                </Button>
                <Button
                    onClick={deleteToken}
                    disabled={isDeleting}
                    variant="danger"
                    className="btn-danger"
                >
                    {t('delete')}
                </Button>
            </OLModalFooter>
        </>
    )
}

type DeleteAuthenticationTokenModalProps = {
    show,
    handleHide,
    tokenId,
}

function DeleteAuthenticationTokenModal({ show, handleHide, tokenId }: DeleteAuthenticationTokenModalProps) {
    return (
        <OLModal
            animation
            show={show}
            onHide={handleHide}
            id="delete-authentication-token-modal"
            backdrop='static'
        >
            <ModalDeleteAuthenticationToken
                handleHide={handleHide} tokenId={tokenId}
            />
        </OLModal>
    )
}

export default memo(DeleteAuthenticationTokenModal)