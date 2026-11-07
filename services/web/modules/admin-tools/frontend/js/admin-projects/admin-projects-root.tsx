import { useTranslation } from 'react-i18next'
import { Nav, TabContainer, TabContent, TabPane } from 'react-bootstrap'
import useWaitForI18n from '@/shared/hooks/use-wait-for-i18n'
import useBookmarkableTabSet from '@/shared/hooks/use-bookmarkable-tabset'
import withErrorBoundary from '@/infrastructure/error-boundary'
import { GenericErrorBoundaryFallback } from '@/shared/components/generic-error-boundary-fallback'
import OLRow from '@/shared/components/ol/ol-row'
import OLCol from '@/shared/components/ol/ol-col'
import { getOptions } from '../admin-users/meta'
import ProjectsList from '../shared/projects-list'
import TemplatesList from './templates-list'

// /admin/project (the core navbar's "Project/Object Lookup"), on the user
// list's layout: every project of the site, the list of a user's Projects tab
// with an Owner column, and the templates while the template gallery is on
function AdminProjectsTabs() {
  const { t } = useTranslation()
  const [activeTab, setActiveTab] = useBookmarkableTabSet('projects')
  const { templatesEnabled } = getOptions()

  return (
    <TabContainer activeKey={activeTab} onSelect={setActiveTab}>
      <Nav as="nav" className="admin-panel-tabs" aria-label={t('admin_panel')}>
        <Nav.Link eventKey="projects" className="admin-panel-tab">
          {t('projects')}
        </Nav.Link>
        {templatesEnabled && (
          <Nav.Link eventKey="templates" className="admin-panel-tab">
            {t('templates')}
          </Nav.Link>
        )}
      </Nav>
      <TabContent>
        <TabPane eventKey="projects">
          <ProjectsList
            url="/admin/projects/list"
            id="admin-projects"
            active={activeTab === 'projects'}
            placeholder={t('search_by_project_name_id_owner_or_link')}
          />
        </TabPane>
        {templatesEnabled && (
          <TabPane eventKey="templates">
            <TemplatesList active={activeTab === 'templates'} />
          </TabPane>
        )}
      </TabContent>
    </TabContainer>
  )
}

function AdminProjectsRoot() {
  const { isReady } = useWaitForI18n()
  if (!isReady) return null

  return (
    <div className="container admin-panel-container">
      <OLRow>
        <OLCol xl={{ span: 10, offset: 1 }}>
          <AdminProjectsTabs />
        </OLCol>
      </OLRow>
    </div>
  )
}

export default withErrorBoundary(AdminProjectsRoot, () => (
  <GenericErrorBoundaryFallback />
))
