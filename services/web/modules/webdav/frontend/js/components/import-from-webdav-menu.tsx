import React from 'react'
import { useTranslation } from 'react-i18next'
import { OLDropdownItem } from '@/shared/components/ol/ol-dropdown-menu'
import useInstanceFeatures from '@modules/instance-features/frontend/js/use-instance-features'

/**
 * "New project" dropdown item: import a project from WebDAV.
 * Rendered by the project-list new-project dropdown when the operator
 * enabled WEBDAV_ENABLED for the instance.
 */
export default function ImportFromWebdavMenu({
  onClick,
}: {
  onClick: (e: React.MouseEvent) => void
}) {
  const { t } = useTranslation()
  const { webdav } = useInstanceFeatures()
  if (!webdav) {
    return null
  }
  return (
    <OLDropdownItem onClick={onClick}>
      {t('webdav.import_from_webdav')}
    </OLDropdownItem>
  )
}
