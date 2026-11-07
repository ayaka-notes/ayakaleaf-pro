import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { deleteJSON } from '@/infrastructure/fetch-json'
import OLTable, { TableContainer } from '@/shared/components/ol/ol-table'
import OLIconButton from '@/shared/components/ol/ol-icon-button'
import OLTooltip from '@/shared/components/ol/ol-tooltip'
import OLNotification from '@/shared/components/notification'
import {
  type Action,
  ConfirmModal,
} from '../admin-users/components/user-actions'
import { RelativeDate } from '../admin-users/components/users-table'
import ListSearch from '../shared/list-search'
import ListFooter from '../shared/list-footer'
import SortHeader from '../shared/sort-header'
import { usePagedList, useReloadWhenShown } from '../shared/use-paged-list'

type TemplatesQuery = {
  page: number
  pageSize: number
  search: string
  sort: 'name' | 'lastUpdated'
  order: 'asc' | 'desc'
}
type TemplateRow = {
  id: string
  name: string
  author?: string
  owner: { id?: string; email?: string; name?: string }
  lastUpdated?: string
}
type TemplatesResult = {
  query: TemplatesQuery
  total: number
  page: number
  templates: TemplateRow[]
}

// The templates of the gallery, laid out like the list of projects. A template
// opens on the gallery's page.
function TemplatesList({ active }: { active: boolean }) {
  const { t } = useTranslation()
  const [deleting, setDeleting] = useState<TemplateRow | null>(null)
  const { query, result, loading, error, updateQuery, reload } = usePagedList<
    TemplatesQuery,
    TemplatesResult
  >('/admin/templates/list', {
    page: 1,
    pageSize: 10,
    search: '',
    sort: 'lastUpdated',
    order: 'desc',
  })
  useReloadWhenShown(active, reload)

  const sortBy = (sort: TemplatesQuery['sort']) => ({
    label: sort === 'name' ? t('title') : t('last_modified'),
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

  const deleteAction = (template: TemplateRow): Action => ({
    key: 'template-delete',
    icon: 'delete',
    label: t('delete'),
    danger: true,
    warning: t('this_action_cannot_be_undone'),
    run: () => deleteJSON(`/admin/templates/${template.id}`),
  })

  return (
    <>
      <section className="admin-panel-toolbar">
        <ListSearch
          initialValue={query.search}
          loading={loading}
          onSearch={(search, options) => updateQuery({ search }, options)}
        />
      </section>

      {error && (
        <OLNotification
          type="error"
          content={t('generic_something_went_wrong')}
          className="mb-3"
        />
      )}

      <div
        className={
          loading
            ? 'admin-panel-table-wrapper admin-panel-loading'
            : 'admin-panel-table-wrapper'
        }
      >
        <TableContainer bordered responsive>
          <OLTable container={false} className="admin-panel-table">
            <thead>
              <tr>
                <SortHeader {...sortBy('name')} />
                <th scope="col" className="d-none d-md-table-cell">
                  {t('author')}
                </th>
                <th scope="col" className="d-none d-md-table-cell">
                  {t('owner')}
                </th>
                <SortHeader
                  {...sortBy('lastUpdated')}
                  className="d-none d-md-table-cell"
                />
                <th scope="col" className="admin-panel-cell-actions">
                  {t('actions')}
                </th>
              </tr>
            </thead>
            <tbody>
              {result?.templates.map(template => (
                <tr key={template.id}>
                  <td className="admin-panel-cell-user">
                    <div className="admin-panel-user-name">
                      <a href={`/template/${template.id}`}>{template.name}</a>
                    </div>
                  </td>
                  <td className="d-none d-md-table-cell">{template.author}</td>
                  <td className="d-none d-md-table-cell">
                    {template.owner.id && (
                      <a
                        className="admin-panel-plain-link"
                        href={`/admin/user/${template.owner.id}`}
                      >
                        {template.owner.name ||
                          template.owner.email ||
                          template.owner.id}
                      </a>
                    )}
                    {template.owner.name && (
                      <div className="admin-panel-muted">
                        {template.owner.email}
                      </div>
                    )}
                  </td>
                  <td className="d-none d-md-table-cell">
                    <RelativeDate date={template.lastUpdated} />
                  </td>
                  <td className="admin-panel-cell-actions">
                    <div className="admin-panel-actions">
                      <OLTooltip
                        id={`admin-open-template-${template.id}`}
                        description={t('view')}
                        overlayProps={{ placement: 'top' }}
                      >
                        <OLIconButton
                          variant="ghost"
                          size="sm"
                          icon="open_in_new"
                          className="action-btn"
                          accessibilityLabel={t('view')}
                          href={`/template/${template.id}`}
                          target="_blank"
                          rel="noreferrer"
                        />
                      </OLTooltip>
                      <OLTooltip
                        id={`admin-delete-template-${template.id}`}
                        description={t('delete')}
                        overlayProps={{ placement: 'top' }}
                      >
                        <OLIconButton
                          variant="ghost"
                          size="sm"
                          icon="delete"
                          className="action-btn admin-panel-action-danger"
                          accessibilityLabel={t('delete')}
                          onClick={() => setDeleting(template)}
                        />
                      </OLTooltip>
                    </div>
                  </td>
                </tr>
              ))}
              {result && result.templates.length === 0 && (
                <tr>
                  <td colSpan={5} className="admin-panel-empty">
                    {t('no_search_results')}
                  </td>
                </tr>
              )}
            </tbody>
          </OLTable>
        </TableContainer>
      </div>

      {result && (
        <ListFooter
          id="admin-templates"
          shownText={t('showing_x_results_of_total', {
            count: result.templates.length,
            total: result.total,
          })}
          total={result.total}
          page={result.page}
          pageSize={result.query.pageSize}
          onChange={updateQuery}
        />
      )}
      {deleting && (
        <ConfirmModal
          subject={{ title: deleting.name }}
          action={deleteAction(deleting)}
          onHide={() => setDeleting(null)}
          onDone={reload}
        />
      )}
    </>
  )
}

export default TemplatesList
