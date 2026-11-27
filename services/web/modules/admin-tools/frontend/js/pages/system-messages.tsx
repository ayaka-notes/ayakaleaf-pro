import { renderInReactLayout } from '@/react'
import '@/utils/meta'
import '@/infrastructure/error-reporter'
import '@/i18n'
import SystemMessagesRoot from '../system-messages-root'
import '../../stylesheets/system-messages-admin.scss'

renderInReactLayout('system-messages-root', () => <SystemMessagesRoot />)
