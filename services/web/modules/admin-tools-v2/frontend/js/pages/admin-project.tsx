import { renderInReactLayout } from '@/react'
import '@/utils/meta'
import '@/utils/webpack-public-path'
import '@/infrastructure/error-reporter'
import '@/i18n'
import AdminProjectRoot from '../admin-project/admin-project-root'
import '../../stylesheets/admin-panel.scss'

renderInReactLayout('admin-project-root', () => <AdminProjectRoot />)
