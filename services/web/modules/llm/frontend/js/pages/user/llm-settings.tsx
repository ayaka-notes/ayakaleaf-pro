import { renderInReactLayout } from '@/react'
import '@/utils/meta'
import '@/utils/webpack-public-path'
import '@/infrastructure/error-reporter'
import '@/i18n'
import LLMSettingsPage from '../../components/llm-settings-page'

renderInReactLayout('settings-page-root', () => <LLMSettingsPage />)
