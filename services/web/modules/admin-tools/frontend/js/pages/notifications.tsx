import { createRoot } from 'react-dom/client'
import NotificationsAdminRoot from '../notifications-admin-root'
import '../../stylesheets/notifications-admin.scss'

const element = document.getElementById('notifications-admin-root')
if (element) {
  const root = createRoot(element)
  root.render(<NotificationsAdminRoot />)
}
