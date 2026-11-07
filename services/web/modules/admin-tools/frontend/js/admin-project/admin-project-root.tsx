import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Nav, TabContainer, TabContent, TabPane } from 'react-bootstrap'
import useWaitForI18n from '@/shared/hooks/use-wait-for-i18n'
import useBookmarkableTabSet from '@/shared/hooks/use-bookmarkable-tabset'
import withErrorBoundary from '@/infrastructure/error-boundary'
import { GenericErrorBoundaryFallback } from '@/shared/components/generic-error-boundary-fallback'
import OLIconButton from '@/shared/components/ol/ol-icon-button'
import OLTooltip from '@/shared/components/ol/ol-tooltip'
import OLRow from '@/shared/components/ol/ol-row'
import OLCol from '@/shared/components/ol/ol-col'
import { ConfirmModal, type Action } from '../admin-users/components/user-actions'
import {
  ProjectStatusBadge,
  changeOwnerAction,
  projectActions,
} from '../shared/project-status'
import AuditLogTab from '../admin-user/tabs/audit-log-tab'
import { getAdminProject } from './meta'
import OverviewTab from './tabs/overview-tab'
import FilesTab from './tabs/files-tab'
import MembersTab from './tabs/members-tab'
import DeletedFilesTab from './tabs/deleted-files-tab'

// The same layout as the user page: back to the owner's projects, the name
// with its status and the actions, one row of tabs
function AdminProjectPage() {
  const { t } = useTranslation()
  const { owner, ownerId } = getAdminProject()
  // the overview's form updates the name in the header after a save
  const [project, setProject] = useState(() => getAdminProject().project)
  const [activeTab, setActiveTab] = useBookmarkableTabSet('overview')
  const [open, setOpen] = useState<Action | null>(null)
  // the header's pencil edits the tab that has a form (overview, members),
  // as on the user page; each tab keeps its own edit mode
  const [editingTab, setEditingTab] = useState<string | null>(null)
  const editableTabs = ['overview', 'members']
  const editProps = (key: string) => ({
    editing: editingTab === key,
    onEditingChange: (editing: boolean) => setEditingTab(editing ? key : null),
  })
  const ownerKey = owner?.id ?? ownerId
  const ownerName =
    [owner?.firstName, owner?.lastName].filter(Boolean).join(' ') ||
    owner?.email ||
    ownerKey
  const deleted = project.status === 'deleted'

  const changeOwner = changeOwnerAction(t, project.id, ownerKey)
  const overview = (
    <OverviewTab
      project={project}
      onSaved={setProject}
      {...editProps('overview')}
      onChangeOwner={() => setOpen(changeOwner)}
    />
  )

  const tabs = deleted
    ? [{ key: 'overview', label: t('overview'), content: overview }]
    : [
        { key: 'overview', label: t('overview'), content: overview },
        { key: 'files', label: t('file_tree'), content: <FilesTab /> },
        { key: 'members', label: t('members'), content: <MembersTab {...editProps('members')} /> },
        {
          key: 'deleted-files',
          label: t('deleted_files'),
          content: <DeletedFilesTab />,
        },
        {
          key: 'audit-logs',
          label: t('audit_logs'),
          content: (
            <AuditLogTab
              active={activeTab === 'audit-logs'}
              url={`/admin/project/${project.id}/audit-log/list`}
            />
          ),
        },
      ]

  // after a purge the page is gone: back to the owner's deleted projects
  const done = (action: Action) => {
    if (action.key === 'project-purge') {
      window.location.assign(`/admin/user/${ownerKey}#projects`)
    } else {
      window.location.reload()
    }
  }

  const linkAction = (icon: string, label: string, href: string) => (
    <OLTooltip
      id={`admin-project-${icon}`}
      description={label}
      overlayProps={{ placement: 'top' }}
    >
      <OLIconButton
        variant="ghost"
        size="sm"
        icon={icon}
        className="action-btn"
        accessibilityLabel={label}
        href={href}
        target="_blank"
        rel="noreferrer"
      />
    </OLTooltip>
  )

  return (
    <>
      {/* core's back link, as on the template pages */}
      <a className="previous-page-link admin-panel-back" href={`/admin/user/${ownerKey}#projects`}>
        <i className="material-symbols material-symbols-rounded" aria-hidden="true">
          arrow_left_alt
        </i>
        <span>{ownerName}</span>
      </a>
      <header className="admin-panel-user-header">
        <div className="admin-panel-user-header-name">
          {project.name}
          <ProjectStatusBadge status={project.status} />
        </div>
        <div className="admin-panel-actions">
          {!deleted && editableTabs.includes(activeTab) && (
            <OLTooltip
              id="admin-project-edit"
              description={t('edit')}
              overlayProps={{ placement: 'top' }}
            >
              <OLIconButton
                variant="ghost"
                size="sm"
                icon="edit"
                className="action-btn"
                accessibilityLabel={t('edit')}
                onClick={() => setEditingTab(activeTab)}
              />
            </OLTooltip>
          )}
          {!deleted && (
            <>
              {linkAction('open_in_new', t('open_project'), `/project/${project.id}`)}
              {linkAction(
                'download',
                t('download'),
                `/project/${project.id}/download/zip`
              )}
            </>
          )}
          {projectActions(t, project).map(action => (
            <OLTooltip
              key={action.key}
              id={`admin-${action.key}`}
              description={action.label}
              overlayProps={{ placement: 'top' }}
            >
              <OLIconButton
                variant="ghost"
                size="sm"
                icon={action.icon}
                className={
                  action.danger
                    ? 'action-btn admin-panel-action-danger'
                    : 'action-btn'
                }
                accessibilityLabel={action.label}
                onClick={() => setOpen(action)}
              />
            </OLTooltip>
          ))}
        </div>
      </header>
      <TabContainer activeKey={activeTab} onSelect={setActiveTab}>
        <Nav as="nav" className="admin-panel-tabs" aria-label={t('overview')}>
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
      {open && (
        <ConfirmModal
          subject={{ title: project.name }}
          action={open}
          onHide={() => setOpen(null)}
          onDone={() => done(open)}
        />
      )}
    </>
  )
}

function AdminProjectRoot() {
  const { isReady } = useWaitForI18n()
  if (!isReady) return null

  return (
    <div className="container admin-panel-container">
      <OLRow>
        <OLCol xl={{ span: 10, offset: 1 }}>
          <AdminProjectPage />
        </OLCol>
      </OLRow>
    </div>
  )
}

export default withErrorBoundary(AdminProjectRoot, () => (
  <GenericErrorBoundaryFallback />
))
