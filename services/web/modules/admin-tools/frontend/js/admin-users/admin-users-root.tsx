import { useTranslation } from 'react-i18next'
import { Nav, TabContainer, TabContent, TabPane } from 'react-bootstrap'
import useWaitForI18n from '@/shared/hooks/use-wait-for-i18n'
import useBookmarkableTabSet from '@/shared/hooks/use-bookmarkable-tabset'
import withErrorBoundary from '@/infrastructure/error-boundary'
import { GenericErrorBoundaryFallback } from '@/shared/components/generic-error-boundary-fallback'
import OLRow from '@/shared/components/ol/ol-row'
import OLCol from '@/shared/components/ol/ol-col'
import UsersPage from './components/users-page'
import LicenseTab from './components/license-tab'

// Laid out like account settings: the site navbar, then the content in the
// same centred column. The two tabs are the top level, as before.
function AdminUsersTabs() {
  const { t } = useTranslation()
  const [activeTab, setActiveTab] = useBookmarkableTabSet('users')

  return (
    <TabContainer activeKey={activeTab} onSelect={setActiveTab}>
      <Nav as="nav" className="admin-panel-tabs" aria-label={t('admin_panel')}>
        <Nav.Link eventKey="users" className="admin-panel-tab">
          {t('user_administration')}
        </Nav.Link>
        <Nav.Link eventKey="license" className="admin-panel-tab">
          {t('license')}
        </Nav.Link>
      </Nav>
      <TabContent>
        <TabPane eventKey="users">
          <UsersPage />
        </TabPane>
        <TabPane eventKey="license">
          <LicenseTab />
        </TabPane>
      </TabContent>
    </TabContainer>
  )
}

function AdminUsersRoot() {
  const { isReady } = useWaitForI18n()
  if (!isReady) return null

  return (
    <div className="container admin-panel-container">
      <OLRow>
        <OLCol xl={{ span: 10, offset: 1 }}>
          <AdminUsersTabs />
        </OLCol>
      </OLRow>
    </div>
  )
}

export default withErrorBoundary(AdminUsersRoot, () => (
  <GenericErrorBoundaryFallback />
))
