import { useTranslation } from 'react-i18next'
import OLTable, { TableContainer } from '@/shared/components/ol/ol-table'
import { getAdminUser } from '../meta'
import { DetailsTable } from '../details-table'
import { BoolIcon, ShortDate } from './shared'

function IntegrationsTab() {
  const { t } = useTranslation()
  const { integrations } = getAdminUser()
  if (!integrations) return null
  const { gitTokens, linked } = integrations

  return (
    <>
      <h3 className="admin-panel-section-title">{t('git_integration')}</h3>
      <div className="admin-panel-details-wrapper">
        <TableContainer bordered>
          <OLTable container={false} className="admin-panel-table">
            <thead>
              <tr>
                <th scope="col">{t('token')}</th>
                <th scope="col">{t('created_at')}</th>
                <th scope="col">{t('last_used')}</th>
                <th scope="col">{t('expires')}</th>
              </tr>
            </thead>
            <tbody>
              {gitTokens.map(token => (
                <tr key={token.id}>
                  <td>
                    <code>{token.prefix}************</code>
                  </td>
                  <td>
                    <ShortDate date={token.createdAt} />
                  </td>
                  <td>
                    {token.lastUsedAt ? (
                      <ShortDate date={token.lastUsedAt} />
                    ) : (
                      <span className="admin-panel-muted">—</span>
                    )}
                  </td>
                  <td>
                    <ShortDate date={token.expiresAt} />
                  </td>
                </tr>
              ))}
              {gitTokens.length === 0 && (
                <tr>
                  <td colSpan={4} className="admin-panel-empty">
                    —
                  </td>
                </tr>
              )}
            </tbody>
          </OLTable>
        </TableContainer>
      </div>

      <h3 className="admin-panel-section-title">{t('linked_accounts')}</h3>
      <DetailsTable
        rows={[
          ['GitHub', <BoolIcon key="github" value={linked.github} label="GitHub" />],
          ['GitLab', <BoolIcon key="gitlab" value={linked.gitlab} label="GitLab" />],
          ['Gitea', <BoolIcon key="gitea" value={linked.gitea} label="Gitea" />],
          [t('dropbox'), <BoolIcon key="dropbox" value={linked.dropbox} label={t('dropbox')} />],
          [t('zotero'), <BoolIcon key="zotero" value={linked.zotero} label={t('zotero')} />],
          [t('mendeley'), <BoolIcon key="mendeley" value={linked.mendeley} label={t('mendeley')} />],
        ]}
      />
    </>
  )
}

export default IntegrationsTab
