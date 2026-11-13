import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import OLTable, { TableContainer } from '@/shared/components/ol/ol-table'
import MaterialIcon from '@/shared/components/material-icon'
import { getAdminProject } from '../meta'
import type { ProjectEntry } from '../types'

const IMAGE = /\.(png|jpe?g|gif|svg|webp|bmp|tiff?|eps|pdf)$/i

// the editor's file tree icons: a folder, a doc, an image or another file
function icon(entry: ProjectEntry) {
  if (entry.type === 'folder') return 'folder'
  if (entry.type === 'doc') return 'description'
  return IMAGE.test(entry.path) ? 'image' : 'draft'
}

// "/a/b/c.tex" -> ["/a", "/a/b"]: the folders an entry sits in
function parents(path: string) {
  const parts = path.split('/').filter(Boolean)
  return parts.slice(0, -1).map((_, i) => '/' + parts.slice(0, i + 1).join('/'))
}

// the editor's order: at each level folders first, then by name
function treeOrder(a: ProjectEntry, b: ProjectEntry) {
  const pa = a.path.split('/').filter(Boolean)
  const pb = b.path.split('/').filter(Boolean)
  for (let i = 0; i < Math.min(pa.length, pb.length); i++) {
    if (pa[i] !== pb[i]) {
      const aFolder = i < pa.length - 1 || a.type === 'folder'
      const bFolder = i < pb.length - 1 || b.type === 'folder'
      if (aFolder !== bFolder) return aFolder ? -1 : 1
      return pa[i].localeCompare(pb[i])
    }
  }
  // a folder comes before what it holds
  return pa.length - pb.length
}

// The project's file tree, read only, as the editor shows it: folders fold
// and unfold (all folded at first), entries indented by depth
function FilesTab() {
  const { t } = useTranslation()
  const { project } = getAdminProject()
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())

  const toggle = (path: string) =>
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })

  const entries = useMemo(
    () => [...project.entries].sort(treeOrder),
    [project.entries]
  )
  // an entry shows when every folder above it is unfolded
  const visible = entries.filter(entry =>
    parents(entry.path).every(folder => expanded.has(folder))
  )

  return (
    <TableContainer bordered responsive>
      <OLTable container={false} className="admin-panel-table">
        <thead>
          <tr>
            <th scope="col">{t('name')}</th>
          </tr>
        </thead>
        <tbody>
          {visible.map(entry => {
            const parts = entry.path.split('/').filter(Boolean)
            const name = parts[parts.length - 1]
            const indent = { paddingLeft: `${(parts.length - 1) * 20}px` }
            const open = expanded.has(entry.path)
            return (
              <tr key={entry.path}>
                <td>
                  {entry.type === 'folder' ? (
                    <button
                      type="button"
                      className="admin-panel-file admin-panel-file-folder"
                      style={indent}
                      aria-expanded={open}
                      onClick={() => toggle(entry.path)}
                    >
                      <MaterialIcon
                        type={open ? 'expand_more' : 'chevron_right'}
                        className="admin-panel-muted"
                      />
                      <MaterialIcon type="folder" className="admin-panel-muted" />
                      {name}
                    </button>
                  ) : (
                    <span className="admin-panel-file" style={indent}>
                      {/* the chevron's room, so names of one level line up */}
                      <span className="admin-panel-file-chevron" />
                      <MaterialIcon type={icon(entry)} className="admin-panel-muted" />
                      {name}
                    </span>
                  )}
                </td>
              </tr>
            )
          })}
          {project.entries.length === 0 && (
            <tr>
              <td className="admin-panel-empty">—</td>
            </tr>
          )}
        </tbody>
      </OLTable>
    </TableContainer>
  )
}

export default FilesTab
