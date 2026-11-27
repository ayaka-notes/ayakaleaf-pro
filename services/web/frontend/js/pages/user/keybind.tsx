import { renderInReactLayout } from '@/react'
import '@/utils/meta'
import '@/utils/webpack-public-path'
import '@/infrastructure/error-reporter'
import '@/i18n'
import KeybindingsPageRoot from '@/features/settings/components/key-bindings-page-root'
import { UserProvider } from '@/shared/context/user-context'

renderInReactLayout('keybind-page-root', () => (
  <UserProvider>
    <KeybindingsPageRoot />
  </UserProvider>
))
