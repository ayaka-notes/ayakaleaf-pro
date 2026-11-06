import { renderInReactLayout } from '@/react'
import '@/utils/meta'
import '@/utils/webpack-public-path'
import '@/infrastructure/error-reporter'
import '@/i18n'
import AdminProjectsRoot from '../admin-projects/admin-projects-root'
import '../../stylesheets/admin-panel.scss'

renderInReactLayout('admin-projects-root', () => <AdminProjectsRoot />)
