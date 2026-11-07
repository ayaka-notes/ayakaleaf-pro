import { useTranslation } from 'react-i18next'
import getMeta from '@/utils/meta'
import {
  OLModalBody,
  OLModalFooter,
} from '@/shared/components/ol/ol-modal'
import OLButton from '@/shared/components/ol/ol-button'

const GitSyncNeedAuthModal = ({ handleHide }: { handleHide: () => void }) => {
  const { t } = useTranslation()
  const { appName } = getMeta('ol-ExposedSettings')
  return (
    <>
      <OLModalBody>
        <p>{t('link_to_github_description', { appName })}</p>
      </OLModalBody>
      <OLModalFooter>
        <OLButton
          variant="secondary"
          onClick={handleHide}
        >
          {t('close')}
        </OLButton>

        <OLButton
          variant="primary"
          onClick={() => {
            handleHide()
            window.open(
              '/user/github-sync/oauth2',
              'githubAuth',
              'width=600,height=700'
            )
          }}
        >
          {t('link_to_github')}
        </OLButton>
      </OLModalFooter>
    </>
  )
}

export default GitSyncNeedAuthModal
