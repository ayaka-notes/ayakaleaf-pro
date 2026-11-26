import { renderInReactLayout } from '@/react'
import '@/utils/meta'
import '@/infrastructure/error-reporter'
import '@/i18n'
import ActiveProjectsRoot from '../active-projects-root'
import '../../stylesheets/active-projects-admin.scss'

renderInReactLayout('active-projects-root', () => <ActiveProjectsRoot />)
