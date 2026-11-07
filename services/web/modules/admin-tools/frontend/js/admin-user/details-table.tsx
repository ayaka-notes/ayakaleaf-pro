import { ReactNode } from 'react'
import OLTable, { TableContainer } from '@/shared/components/ol/ol-table'

// A label | value table in core's bordered panel, as the user info table of
// the original admin page
export function DetailsTable({
  rows,
}: {
  rows: [label: string, value: ReactNode][]
}) {
  return (
    <div className="admin-panel-details-wrapper">
      <TableContainer bordered>
        <OLTable container={false} className="admin-panel-table admin-panel-details">
          <tbody>
            {rows.map(([label, value]) => (
              <tr key={label}>
                <th scope="row">{label}</th>
                <td>
                  {value == null || value === '' ? (
                    <span className="admin-panel-muted">—</span>
                  ) : (
                    value
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </OLTable>
      </TableContainer>
    </div>
  )
}
