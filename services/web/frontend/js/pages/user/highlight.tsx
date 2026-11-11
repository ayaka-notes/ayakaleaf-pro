import { renderInReactLayout } from '@/react'
import '@/utils/meta'
import '@/utils/webpack-public-path'
import '@/infrastructure/error-reporter'
import '@/i18n'
import HighlightRoot from '@/features/highlight/root'
import { UserProvider } from '@/shared/context/user-context'

renderInReactLayout('highlight-root', () => (
  <UserProvider>
    <HighlightRoot />
  </UserProvider>
))
