import { renderInReactLayout } from '@/react'
import '@/utils/meta'
import '@/utils/webpack-public-path'
import '@/infrastructure/error-reporter'
import '@/i18n'
import AdminSiteSettingsRoot from '../site-settings/site-settings-root'
import '../../stylesheets/admin-panel.scss'

renderInReactLayout('admin-site-settings-root', () => (
  <AdminSiteSettingsRoot />
))
