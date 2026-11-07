import { useProjectContext } from '@/shared/context/project-context'
import { useTranslation } from 'react-i18next'
import OLRow from '@/shared/components/ol/ol-row'
import OLCol from '@/shared/components/ol/ol-col'
import ShareProjectModalRow from '@/features/share-project-modal/components/share-project-modal-row'
import MaterialIcon from '@/shared/components/material-icon'
import { useFeatureFlag } from '@/shared/context/split-test-context'

export default function OwnerInfo() {
  const isSharingUpdatesEnabled = useFeatureFlag('sharing-updates')
  const { t } = useTranslation()
  const { project } = useProjectContext()

  return isSharingUpdatesEnabled ? (
    <ShareProjectModalRow>
      <div className="d-inline-flex align-items-center h5 m-0 gap-2">
        <MaterialIcon type="person" unfilled />
        <div className="px-2">{project?.owner.email}</div>
      </div>
      <div className="h5 m-0 px-4 fw-semibold">
        <div className="form-control-plaintext border-0">{t('owner')}</div>
      </div>
    </ShareProjectModalRow>
  ) : (
    <OLRow className="project-member">
      <OLCol xs={8}>
        <div className="project-member-email-icon">
          <MaterialIcon type="person" />
          <div className="email-warning">{project?.owner.email}</div>
        </div>
      </OLCol>
      <OLCol xs={4} className="text-end">
        {t('owner')}
      </OLCol>
    </OLRow>
  )
}
