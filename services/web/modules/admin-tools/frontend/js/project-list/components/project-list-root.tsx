import { useEffect } from 'react'
import {
  useProjectListContext,
} from '../context/project-list-context'
import * as eventTracking from '@/infrastructure/event-tracking'
import { useTranslation } from 'react-i18next'
import LoadingBranded from '@/shared/components/loading-branded'
import { ProjectListDsNav } from './project-list-ds-nav'
import { DsNavStyleProvider } from '@/features/project-list/components/use-is-ds-nav'
import useThemedPage from '@/shared/hooks/use-themed-page'

export default function ProjectListRoot() {

  useThemedPage()
  const { isLoading, loadProgress } = useProjectListContext()

  const { t } = useTranslation()

  useEffect(() => {
    eventTracking.sendMB('loads_v2_dash', {})
  }, [])

  if (isLoading) {
    return (
      <LoadingBranded loadProgress={loadProgress} label={t('loading')} />
    )
  }

  return (
    <DsNavStyleProvider>
      <ProjectListDsNav />
    </DsNavStyleProvider>
  )
}
