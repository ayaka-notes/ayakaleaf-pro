import { renderInReactLayout } from '@/react'
import '@/utils/meta'
import '@/utils/webpack-public-path'
import '@/infrastructure/error-reporter'
import '@/i18n'
import AdminUsersRoot from '../admin-users/admin-users-root'
import '../../stylesheets/admin-panel.scss'

// renderInReactLayout also mounts the site navbar and footer, like the
// account settings page
renderInReactLayout('admin-users-root', () => <AdminUsersRoot />)
