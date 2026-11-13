import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import classnames from 'classnames'
import OLTable, { TableContainer } from '@/shared/components/ol/ol-table'
import OLIconButton from '@/shared/components/ol/ol-icon-button'
import OLTooltip from '@/shared/components/ol/ol-tooltip'
import OLNotification from '@/shared/components/notification'
import FilterDropdown, {
  statusOptionLayout,
} from '../admin-users/components/filter-dropdown'
import {
  MatchedEmails,
  PrimaryBadge,
  RelativeDate,
} from '../admin-users/components/users-table'
import type { MatchedEmail } from '../admin-users/types'
import ListSearch from './list-search'
import ListFooter from './list-footer'
import SortHeader from './sort-header'
import {
  fromSearchParams,
  usePagedList,
  useQueryInUrl,
  useReloadWhenShown,
} from './use-paged-list'
import DeletedHint from './deleted-hint'
import { useSelection } from './selection'
import OLFormCheckbox from '@/shared/components/ol/ol-form-checkbox'
import ProjectsBulkActions from './projects-bulk-actions'
import { ConfirmModal, type Action } from '../admin-users/components/user-actions'
import {
  ProjectStatusBadge,
  changeOwnerAction,
  projectActions,
  type ProjectStatus as RowStatus,
} from './project-status'

// All is every project that is not deleted, as the user list
type ProjectStatus = 'all' | 'active' | 'archived' | 'trashed' | 'deleted'
type ProjectsQuery = {
  page: number
  pageSize: number
  search: string
  status: ProjectStatus
  sort: 'name' | 'lastUpdated' | 'deletedAt'
  order: 'asc' | 'desc'
}
type ProjectRow = ProjectsResult['projects'][number]
type ProjectsResult = {
  query: ProjectsQuery
  total: number
  page: number
  counts: Record<ProjectStatus, number>
  projects: {
    id: string
    name: string
    lastUpdated?: string
    deletedAt?: string
    status: RowStatus
    // the site's list: each row's owner
    owner?: {
      id?: string
      email?: string
      name?: string
      deleted?: boolean
      // the secondary emails the search found this owner by
      matchedEmails?: MatchedEmail[]
    }
  }[]
}

const DEFAULT_QUERY: ProjectsQuery = {
  page: 1,
  pageSize: 10,
  search: '',
  status: 'all',
  sort: 'lastUpdated',
  order: 'desc',
}

// A list of projects, paged, searched and filtered in the backend, laid out
// like the user list: a user's projects (their page's Projects tab, ownerId)
// or every project of the site (/admin/project, with an Owner column; each
// row's actions go by its own owner)
function ProjectsList({
  url,
  id,
  ownerId,
  active,
  placeholder,
  inUrl = false,
}: {
  url: string
  // the prefix of the controls' ids
  id: string
  ownerId?: string
  // whether its tab shows; opening it again reloads the projects
  active: boolean
  placeholder: string
  // the site's list keeps its query in the URL, as the user list does
  inUrl?: boolean
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState<{ project: ProjectRow; action: Action } | null>(null)
  const ownerOf = (project: ProjectRow) => ownerId ?? project.owner?.id ?? ''
  const { query, result, loading, error, updateQuery, reload } = usePagedList<
    ProjectsQuery,
    ProjectsResult
  >(url, inUrl ? fromSearchParams(DEFAULT_QUERY) : DEFAULT_QUERY)
  useQueryInUrl(query, DEFAULT_QUERY, inUrl)
  useReloadWhenShown(active, reload)

  const labels: Record<ProjectStatus, string> = {
    all: t('all'),
    active: t('active'),
    archived: t('archived'),
    trashed: t('trashed'),
    deleted: t('deleted'),
  }
  const deleted = query.status === 'deleted'

  // ticked rows for the bulk actions; a new page, filter or search clears them
  const selection = useSelection()
  const { clear } = selection
  useEffect(() => clear(), [query, clear])
  const projects = result?.projects ?? []
  const selectedProjects = projects.filter(project => selection.selected.has(project.id))
  const allSelected =
    projects.length > 0 && projects.every(project => selection.selected.has(project.id))
  const bulkDone = () => {
    clear()
    reload()
  }
  const setStatus = (status: ProjectStatus) =>
    updateQuery({
      status,
      // the deleted-at sort exists only for deleted projects
      ...(query.sort === 'deletedAt' && status !== 'deleted'
        ? { sort: 'lastUpdated', order: 'desc' }
        : {}),
    })

  const sortBy = (sort: ProjectsQuery['sort']) => ({
    label: sort === 'name' ? t('title') : sort === 'deletedAt' ? t('deleted_at') : t('last_modified'),
    active: query.sort === sort,
    order: query.order,
    onSort: () =>
      updateQuery({
        sort,
        order:
          query.sort === sort
            ? query.order === 'asc'
              ? 'desc'
              : 'asc'
            : sort === 'name'
              ? 'asc'
              : 'desc',
      }),
  })

  return (
    <>
      <section className="admin-panel-toolbar">
        <ListSearch
          initialValue={query.search}
          loading={loading}
          onSearch={(search, options) => updateQuery({ search }, options)}
          placeholder={placeholder}
        />
        <ProjectsBulkActions
          projects={selectedProjects.map(project => ({ ...project, ownerId: ownerOf(project) }))}
          // the shown rows' status: right after a switch to Deleted the
          // ticked rows are still the live ones until the answer comes
          deleted={result?.query.status === 'deleted'}
          onDone={bulkDone}
        />
      </section>

      <DeletedHint
        search={query.search}
        showingDeleted={deleted}
        count={result?.counts.deleted ?? 0}
        foundText={t('found_matching_deleted_projects', {
          count: result?.counts.deleted ?? 0,
        })}
        showText={t('display_deleted_projects')}
        hideText={t('hide_deleted_projects')}
        onShow={() => setStatus('deleted')}
        onHide={() => setStatus('all')}
      />

      {error && (
        <OLNotification type="error" content={t('generic_something_went_wrong')} className="mb-3" />
      )}

      <div className={loading ? 'admin-panel-table-wrapper admin-panel-loading' : 'admin-panel-table-wrapper'}>
        <TableContainer bordered responsive>
          <OLTable container={false} className="admin-panel-table">
            <thead>
              <tr>
                <th className="admin-panel-cell-checkbox d-none d-md-table-cell">
                  <OLFormCheckbox
                    id={`${id}-select-all`}
                    autoComplete="off"
                    aria-label={t('select_all_projects')}
                    checked={allSelected}
                    disabled={projects.length === 0}
                    onChange={event =>
                      selection.setAll(
                        projects.map(project => project.id),
                        event.target.checked
                      )
                    }
                  />
                </th>
                <SortHeader {...sortBy('name')} />
                {!ownerId && (
                  <th scope="col" className="d-none d-md-table-cell">
                    {t('owner')}
                  </th>
                )}
                <th scope="col" className="admin-panel-th-filter">
                  <FilterDropdown
                    id={`${id}-status`}
                    size="sm"
                    toggleText={
                      query.status === 'all'
                        ? t('status')
                        : `${t('status')}: ${labels[query.status]}`
                    }
                    active={query.status !== 'all'}
                    options={(Object.keys(labels) as ProjectStatus[]).map(value => ({
                      value,
                      label: labels[value],
                      count: result?.counts[value] ?? 0,
                      ...statusOptionLayout(value),
                    }))}
                    value={query.status}
                    onChange={status => setStatus(status as ProjectStatus)}
                  />
                </th>
                <SortHeader
                  {...sortBy(deleted ? 'deletedAt' : 'lastUpdated')}
                  className="d-none d-md-table-cell"
                />
                <th scope="col" className="admin-panel-cell-actions">
                  {t('actions')}
                </th>
              </tr>
            </thead>
            <tbody>
              {result?.projects.map(project => (
                <tr key={project.id}>
                  <td className="admin-panel-cell-checkbox d-none d-md-table-cell">
                    <OLFormCheckbox
                      id={`${id}-select-${project.id}`}
                      autoComplete="off"
                      aria-label={t('select_project', { project: project.name })}
                      checked={selection.selected.has(project.id)}
                      onChange={event => selection.toggle(project.id, event.target.checked)}
                    />
                  </td>
                  <td className="admin-panel-cell-user">
                    <div className="admin-panel-user-name">
                      <a href={`/admin/project/${project.id}`}>{project.name}</a>
                    </div>
                  </td>
                  {!ownerId && (
                    <td className="d-none d-md-table-cell">
                      {project.owner?.id && (
                        <a className="admin-panel-plain-link" href={`/admin/user/${project.owner.id}`}>
                          {project.owner.name || project.owner.email || project.owner.id}
                        </a>
                      )}
                      {!project.owner?.name && project.owner?.matchedEmails?.length ? (
                        <> <PrimaryBadge /></>
                      ) : null}
                      {project.owner?.name && (
                        <div
                          className={classnames('admin-panel-muted', {
                            'admin-panel-inline-field': project.owner.matchedEmails?.length,
                          })}
                        >
                          {project.owner.email}
                          {project.owner.matchedEmails?.length ? <PrimaryBadge /> : null}
                        </div>
                      )}
                      <MatchedEmails
                        className="admin-panel-muted"
                        emails={project.owner?.matchedEmails ?? []}
                      />
                    </td>
                  )}
                  <td>
                    <ProjectStatusBadge status={project.status} />
                  </td>
                  <td className="d-none d-md-table-cell">
                    <RelativeDate
                      date={project.status === 'deleted' ? project.deletedAt : project.lastUpdated}
                    />
                  </td>
                  <td className="admin-panel-cell-actions">
                    <div className="admin-panel-actions">
                      {project.status !== 'deleted' && (
                        <OLTooltip
                          id={`admin-open-project-${project.id}`}
                          description={t('open_project')}
                          overlayProps={{ placement: 'top' }}
                        >
                          <OLIconButton
                            variant="ghost"
                            size="sm"
                            icon="open_in_new"
                            className="action-btn"
                            accessibilityLabel={t('open_project')}
                            href={`/project/${project.id}`}
                            target="_blank"
                            rel="noreferrer"
                          />
                        </OLTooltip>
                      )}
                      {[
                        ...(project.status !== 'deleted'
                          ? [changeOwnerAction(t, project.id, ownerOf(project))]
                          : []),
                        ...projectActions(t, project),
                      ].map(action => (
                        <OLTooltip
                          key={action.key}
                          id={`admin-${action.key}-${project.id}`}
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
                            onClick={() => setOpen({ project, action })}
                          />
                        </OLTooltip>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
              {result && result.projects.length === 0 && (
                <tr>
                  <td colSpan={ownerId ? 5 : 6} className="admin-panel-empty">
                    {t('no_projects')}
                  </td>
                </tr>
              )}
            </tbody>
          </OLTable>
        </TableContainer>
      </div>

      {result && (
        <ListFooter
          id={id}
          shownText={
            // with rows ticked, the line says how many instead
            selectedProjects.length > 0
              ? t('x_selected', { count: selectedProjects.length })
              : t('showing_x_out_of_n_projects', {
                  x: result.projects.length,
                  n: result.total,
                })
          }
          total={result.total}
          page={result.page}
          pageSize={result.query.pageSize}
          onChange={updateQuery}
        />
      )}
      {open && (
        <ConfirmModal
          subject={{ title: open.project.name }}
          action={open.action}
          onHide={() => setOpen(null)}
          onDone={bulkDone}
        />
      )}
    </>
  )
}

export default ProjectsList
