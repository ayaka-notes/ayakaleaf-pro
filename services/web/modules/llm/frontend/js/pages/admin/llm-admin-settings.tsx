import { renderInReactLayout } from '@/react'
import '@/utils/meta'
import '@/utils/webpack-public-path'
import '@/infrastructure/error-reporter'
import '@/i18n'
import LLMAdminSettingsPage from '../../components/llm-admin-settings-page'

renderInReactLayout('llm-admin-settings-root', () => <LLMAdminSettingsPage />)
