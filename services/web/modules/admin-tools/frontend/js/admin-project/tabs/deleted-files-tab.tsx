import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { postJSON } from '@/infrastructure/fetch-json'
import OLTable, { TableContainer } from '@/shared/components/ol/ol-table'
import OLIconButton from '@/shared/components/ol/ol-icon-button'
import OLTooltip from '@/shared/components/ol/ol-tooltip'
import MaterialIcon from '@/shared/components/material-icon'
import { ConfirmModal, type Action } from '../../admin-users/components/user-actions'
import { RelativeDate } from '../../admin-users/components/users-table'
import { getAdminProject } from '../meta'

type DeletedDoc = { id: string; name: string; deletedAt: string }

// The docs deleted from the project (docstore keeps them), as the original
// admin page's Deleted Docs. Core restores one as a copy: a new doc in the
// root folder named "<name>-<date>.tex", while the deleted doc stays deleted
// and listed (and can be restored again, as on the original page); each row
// lists the copies made from it here
function DeletedFilesTab() {
  const { t } = useTranslation()
  const { project, deletedDocs = [] } = getAdminProject()
  const [open, setOpen] = useState<DeletedDoc | null>(null)
  const [copies, setCopies] = useState<Record<string, string[]>>({})

  const restore = (doc: DeletedDoc): Action => ({
    key: 'doc-restore',
    icon: 'restore',
    label: t('restore_file'),
    run: () =>
      postJSON<{ id: string; name: string }>(
        `/admin/project/${project.id}/doc/${doc.id}/restore`
      ).then(copy =>
        setCopies(prev => ({ ...prev, [doc.id]: [...(prev[doc.id] ?? []), copy.name] }))
      ),
  })

  return (
    <>
      <TableContainer bordered responsive>
        <OLTable container={false} className="admin-panel-table">
          <thead>
            <tr>
              <th scope="col">{t('name')}</th>
              <th scope="col">{t('deleted_at')}</th>
              <th scope="col" className="admin-panel-cell-actions">
                {t('actions')}
              </th>
            </tr>
          </thead>
          <tbody>
            {deletedDocs.map(doc => (
              <tr key={doc.id}>
                <td>
                  {doc.name}
                  {copies[doc.id]?.map(name => (
                    <div key={name} className="d-flex align-items-center gap-1 admin-panel-muted">
                      <MaterialIcon type="check" className="admin-panel-bool-on" />/{name}
                    </div>
                  ))}
                </td>
                <td>
                  <RelativeDate date={doc.deletedAt} />
                </td>
                <td className="admin-panel-cell-actions">
                  <div className="admin-panel-actions">
                    <OLTooltip
                      id={`admin-doc-restore-${doc.id}`}
                      description={t('restore_file')}
                      overlayProps={{ placement: 'top' }}
                    >
                      <OLIconButton
                        variant="ghost"
                        size="sm"
                        icon="restore"
                        className="action-btn"
                        accessibilityLabel={t('restore_file')}
                        onClick={() => setOpen(doc)}
                      />
                    </OLTooltip>
                  </div>
                </td>
              </tr>
            ))}
            {deletedDocs.length === 0 && (
              <tr>
                <td colSpan={3} className="admin-panel-empty">
                  —
                </td>
              </tr>
            )}
          </tbody>
        </OLTable>
      </TableContainer>
      {open && (
        <ConfirmModal
          subject={{ title: open.name }}
          action={restore(open)}
          onHide={() => setOpen(null)}
          onDone={() => {}}
        />
      )}
    </>
  )
}

export default DeletedFilesTab
