import { useCallback, useEffect, useState } from 'react'
import { Nav, TabContainer, TabContent, TabPane } from 'react-bootstrap'
import useWaitForI18n from '@/shared/hooks/use-wait-for-i18n'
import withErrorBoundary from '@/infrastructure/error-boundary'
import { GenericErrorBoundaryFallback } from '@/shared/components/generic-error-boundary-fallback'
import OLRow from '@/shared/components/ol/ol-row'
import OLCol from '@/shared/components/ol/ol-col'
import OLSpinner from '@/shared/components/ol/ol-spinner'
import OLNotification from '@/shared/components/notification'
import { getJSON } from '@/infrastructure/fetch-json'
import { SECTIONS_META } from './sections-meta'
import SectionTab, { type SectionData } from './components/section-tab'

/**
 * The Site Settings admin page (/admin/site-settings) — the admin-managed
 * values that hydrate the services' settings at boot, stored in the
 * site_settings collection. External docker env (compose) always wins
 * over the stored values; the page marks every env-controlled field.
 *
 * Chrome: the same top-level tab layout as /admin/user and
 * /admin/project (admin-panel-tabs + centred OLRow/OLCol content).
 */

type SiteSettingsList = {
  order: string[]
  sections: Record<string, SectionData>
  envFields: Record<string, Record<string, string>>
}

function AdminSiteSettingsTabs({
  list,
  refresh,
}: {
  list: SiteSettingsList
  refresh: () => void
}) {
  const [activeTab, setActiveTab] = useState<string>(list.order[0])

  return (
    <TabContainer activeKey={activeTab} onSelect={setActiveTab}>
      <Nav as="nav" className="admin-panel-tabs" aria-label="site settings">
        {list.order.map(name => (
          <Nav.Link key={name} eventKey={name} className="admin-panel-tab">
            {SECTIONS_META[name]?.title || name}
          </Nav.Link>
        ))}
      </Nav>
      <TabContent>
        {list.order.map(name => (
          <TabPane key={name} eventKey={name}>
            {SECTIONS_META[name] ? (
              <SectionTab
                name={name}
                meta={SECTIONS_META[name]}
                data={list.sections[name]}
                envFields={list.envFields[name] || {}}
                onSaved={refresh}
              />
            ) : null}
          </TabPane>
        ))}
      </TabContent>
    </TabContainer>
  )
}

function AdminSiteSettingsRoot() {
  const { isReady } = useWaitForI18n()
  const [list, setList] = useState<SiteSettingsList | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const data = await getJSON<SiteSettingsList>('/admin/site-settings/list')
      setList(data)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  useEffect(() => {
    if (!isReady) return
    load()
  }, [isReady, load])

  if (!isReady) return null

  if (error) {
    return (
      <OLRow>
        <OLCol md={8} className="mx-auto">
          <OLNotification
            type="error"
            content={`Could not load the site settings: ${error}`}
          />
        </OLCol>
      </OLRow>
    )
  }

  if (!list) {
    return (
      <OLRow>
        <OLCol md={8} className="mx-auto">
          <OLSpinner />
        </OLCol>
      </OLRow>
    )
  }

  return (
    <OLRow>
      <OLCol md={10} className="mx-auto">
        <div className="admin-panel-content">
          <AdminSiteSettingsTabs list={list} refresh={load} />
        </div>
      </OLCol>
    </OLRow>
  )
}

export default withErrorBoundary(AdminSiteSettingsRoot, () => (
  <GenericErrorBoundaryFallback />
))
