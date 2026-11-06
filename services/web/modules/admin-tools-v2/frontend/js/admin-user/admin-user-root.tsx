import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Nav, TabContainer, TabContent, TabPane } from 'react-bootstrap'
import useWaitForI18n from '@/shared/hooks/use-wait-for-i18n'
import useBookmarkableTabSet from '@/shared/hooks/use-bookmarkable-tabset'
import withErrorBoundary from '@/infrastructure/error-boundary'
import { GenericErrorBoundaryFallback } from '@/shared/components/generic-error-boundary-fallback'
import OLRow from '@/shared/components/ol/ol-row'
import OLCol from '@/shared/components/ol/ol-col'
import UserActions from '../admin-users/components/user-actions'
import { StatusBadge } from '../admin-users/components/users-table'
import { getAdminUser } from './meta'
import AccountTab from './tabs/account-tab'
import ProjectsTab from './tabs/projects-tab'
import FeaturesTab from './tabs/features-tab'
import IntegrationsTab from './tabs/integrations-tab'
import AuditLogTab from './tabs/audit-log-tab'
import SessionsTab from './tabs/sessions-tab'

// Same layout as the user list: the site navbar, the centred column, one row
// of tabs on top
function AdminUserPage() {
  const { t } = useTranslation()
  // the account form updates the header after a save
  const [user, setUser] = useState(() => getAdminUser().user)
  const [activeTab, setActiveTab] = useBookmarkableTabSet('account')
  // the header's pencil opens the form of the tab, so it shows on the tabs
  // that have one; each tab keeps its own edit mode
  const [editingTab, setEditingTab] = useState<string | null>(null)
  const editableTabs = ['account', 'features']
  const formProps = (key: string) => ({
    user,
    onSaved: setUser,
    editing: editingTab === key,
    onEditingChange: (editing: boolean) => setEditingTab(editing ? key : null),
  })
  const name = [user.firstName, user.lastName].filter(Boolean).join(' ')

  const tabs = user.deleted
    ? [{ key: 'account', label: t('account'), content: <AccountTab {...formProps('account')} /> }]
    : [
        { key: 'account', label: t('account'), content: <AccountTab {...formProps('account')} /> },
        { key: 'projects', label: t('projects'), content: <ProjectsTab active={activeTab === 'projects'} /> },
        { key: 'features', label: t('features'), content: <FeaturesTab {...formProps('features')} /> },
        {
          key: 'integrations',
          label: t('integrations'),
          content: <IntegrationsTab />,
        },
        { key: 'audit-logs', label: t('audit_logs'), content: (
            <AuditLogTab
              active={activeTab === 'audit-logs'}
              url={`/admin/user/${user.id}/audit-log/list`}
              self={{ id: user.id, email: user.email }}
            />
          ),
        },
        { key: 'sessions', label: t('sessions'), content: <SessionsTab /> },
      ]

  return (
    <>
      {/* core's back link, as on the template pages */}
      <a className="previous-page-link admin-panel-back" href="/admin/user">
        <i className="material-symbols material-symbols-rounded" aria-hidden="true">
          arrow_left_alt
        </i>
        <span>{t('user_administration')}</span>
      </a>
      <header className="admin-panel-user-header">
        <div>
          <div className="admin-panel-user-header-name">
            {name || user.email}
            <StatusBadge user={user} />
          </div>
          {name && <div className="admin-panel-muted">{user.email}</div>}
        </div>
        <UserActions user={user} onDone={() => window.location.reload()} onEdit={
            editableTabs.includes(activeTab)
              ? () => setEditingTab(activeTab)
              : undefined
          } />
      </header>
      <TabContainer activeKey={activeTab} onSelect={setActiveTab}>
        <Nav as="nav" className="admin-panel-tabs" aria-label={t('account')}>
          {tabs.map(tab => (
            <Nav.Link key={tab.key} eventKey={tab.key} className="admin-panel-tab">
              {tab.label}
            </Nav.Link>
          ))}
        </Nav>
        <TabContent>
          {tabs.map(tab => (
            <TabPane key={tab.key} eventKey={tab.key}>
              {tab.content}
            </TabPane>
          ))}
        </TabContent>
      </TabContainer>
    </>
  )
}

function AdminUserRoot() {
  const { isReady } = useWaitForI18n()
  if (!isReady) return null

  return (
    <div className="container admin-panel-container">
      <OLRow>
        <OLCol xl={{ span: 10, offset: 1 }}>
          <AdminUserPage />
        </OLCol>
      </OLRow>
    </div>
  )
}

export default withErrorBoundary(AdminUserRoot, () => (
  <GenericErrorBoundaryFallback />
))
