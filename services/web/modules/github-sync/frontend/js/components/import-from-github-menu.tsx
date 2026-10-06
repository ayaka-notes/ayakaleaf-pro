import React from 'react'
import { useTranslation } from 'react-i18next'
import { OLDropdownItem as DropdownItem } from '@/shared/components/ol/ol-dropdown-menu'
import useInstanceFeatures from '@modules/instance-features/frontend/js/use-instance-features'

export default function ImportFromGitHubMenu({ onClick }: { onClick: (e: React.MouseEvent) => void }) {
  const { t } = useTranslation()
  const { githubSync } = useInstanceFeatures()
  if (!githubSync) {
    return null
  }
  return (
    <DropdownItem onClick={onClick}>
      {t('import_from_github')}
    </DropdownItem>
  )
}