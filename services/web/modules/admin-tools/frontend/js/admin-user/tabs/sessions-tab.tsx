import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { postJSON } from '@/infrastructure/fetch-json'
import OLButton from '@/shared/components/ol/ol-button'
import OLTable, { TableContainer } from '@/shared/components/ol/ol-table'
import {
  ConfirmModal,
  userSubject,
  type Action,
} from '../../admin-users/components/user-actions'
import { getAdminUser } from '../meta'
import type { AdminUserMeta } from '../types'
import { FullDate } from './shared'

type Sessions = NonNullable<AdminUserMeta['sessions']>

function SessionsTab() {
  const { t } = useTranslation()
  const adminUser = getAdminUser()
  const [sessions, setSessions] = useState<Sessions>(adminUser.sessions ?? [])
  const [confirming, setConfirming] = useState(false)
  const [cleared, setCleared] = useState(false)

  // confirmed in the same modal as disable and delete; the reply lists what
  // is left: the admin's own current session, when this is their own page
  const clearAction: Action = {
    key: 'clear-sessions',
    icon: 'logout',
    label: t('clear_sessions'),
    danger: true,
    run: () =>
      postJSON<{ sessions: Sessions }>(
        `/admin/user/${adminUser.user.id}/clear-sessions`
      ).then(data => {
        setSessions(data.sessions)
        setCleared(true)
      }),
  }

  return (
    <>
      <TableContainer bordered>
        <OLTable container={false} className="admin-panel-table">
          <thead>
            <tr>
              <th scope="col">{t('ip_address')}</th>
              <th scope="col">{t('session_created_at')}</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((session, i) => (
              <tr key={i}>
                <td>{session.ip_address}</td>
                <td>
                  <FullDate date={session.session_created} />
                </td>
              </tr>
            ))}
            {sessions.length === 0 && (
              <tr>
                <td colSpan={2} className="admin-panel-empty">
                  —
                </td>
              </tr>
            )}
          </tbody>
        </OLTable>
      </TableContainer>
      {/* centred under the table like core's project list "show more";
          the result in a line of text, as core's own sessions page */}
      <div className="text-center mt-3">
        {sessions.length > 0 && (
          <OLButton
            variant="secondary"
            onClick={() => {
              setCleared(false)
              setConfirming(true)
            }}
          >
            {t('clear_sessions')}
          </OLButton>
        )}
        {cleared && (
          <p className="text-success mt-2 mb-0" aria-live="polite">
            {t('clear_sessions_success')}
          </p>
        )}
      </div>
      {confirming && (
        <ConfirmModal
          subject={userSubject(adminUser.user)}
          action={clearAction}
          onHide={() => setConfirming(false)}
          onDone={() => {}}
        />
      )}
    </>
  )
}

export default SessionsTab
