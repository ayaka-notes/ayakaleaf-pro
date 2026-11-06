import { renderInReactLayout } from '@/react'
import '@/utils/meta'
import '@/utils/webpack-public-path'
import '@/infrastructure/error-reporter'
import '@/i18n'
import AdminUserRoot from '../admin-user/admin-user-root'
import '../../stylesheets/admin-panel.scss'

renderInReactLayout('admin-user-root', () => <AdminUserRoot />)
