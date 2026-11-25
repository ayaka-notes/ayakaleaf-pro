import { createRoot } from 'react-dom/client'
import NotificationsAdminRoot from '../notifications-admin-root'
import '../../stylesheets/notifications-admin.scss'
// Mount the shared React navbar + footer into #navbar-container (house
// pattern: standalone pages import the header-footer feature for its
// side effect, e.g. frontend/js/pages/sharing-updates.tsx)
import '../../../../../frontend/js/features/header-footer-react'

const element = document.getElementById('notifications-admin-root')
if (element) {
  const root = createRoot(element)
  root.render(<NotificationsAdminRoot />)
}
