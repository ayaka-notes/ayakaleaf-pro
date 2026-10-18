import { useEffect } from 'react'
import {
  useUserListContext,
} from '../context/user-list-context'
import * as eventTracking from '@/infrastructure/event-tracking'
import { useTranslation } from 'react-i18next'
import { DsNavStyleProvider } from '@/features/project-list/components/use-is-ds-nav'
import LoadingBranded from '@/shared/components/loading-branded'
import useThemedPage from '@/shared/hooks/use-themed-page'
import { UserListDsNav } from './user-list-ds-nav'

export default function UserListRoot() {
  useThemedPage()
  const { isLoading, loadProgress } = useUserListContext()

  useEffect(() => {
    eventTracking.sendMB('loads_v2_dash', {})
  }, [])

  const { t } = useTranslation()

  if (isLoading) {
    const loadingComponent = (
      <LoadingBranded loadProgress={loadProgress} label={t('loading')} />
    )
    return loadingComponent
  }
  return (
    <DsNavStyleProvider>
      <UserListDsNav />
    </DsNavStyleProvider>
  )
}
