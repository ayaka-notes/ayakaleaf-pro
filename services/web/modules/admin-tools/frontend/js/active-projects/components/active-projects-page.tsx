import React, { useCallback, useEffect, useState } from 'react'
import OLButton from '@/shared/components/ol/ol-button'
import OLFormText from '@/shared/components/ol/ol-form-text'
import MaterialIcon from '@/shared/components/material-icon'
import getMeta from '@/utils/meta'
import { postJSON } from '@/infrastructure/fetch-json'
import { debugConsole } from '@/utils/debugging'

type ActiveProjectUser = {
  name: string
  email?: string
}

type ActiveProject = {
  id: string
  name: string
  activeUsers: ActiveProjectUser[]
  connectionCount: number
}

/** The initial list is prefetched by the server (meta tag). */
function initialProjects(): ActiveProject[] {
  const meta = getMeta('ol-activeProjects')
  return Array.isArray(meta) ? (meta as ActiveProject[]) : []
}

const REFRESH_INTERVAL = 30 * 1000

function ActiveProjectsPage() {
  const [projects, setProjects] = useState<ActiveProject[]>(initialProjects)
  const [busy, setBusy] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const refetch = useCallback(async () => {
    setBusy(true)
    try {
      // house convention: admin JSON lists are POST (CSRF-protected)
      const data = await postJSON<ActiveProject[]>(
        '/admin/active-projects/list',
        { body: {} }
      )
      if (Array.isArray(data)) {
        setProjects(data)
        setLastUpdated(new Date())
        setLoadError(null)
      }
    } catch (err) {
      setLoadError('Could not load the current active projects.')
      debugConsole.error(err)
    } finally {
      setBusy(false)
    }
  }, [])

  // Live refresh: 30 s heartbeat + refetch when the tab becomes visible.
  useEffect(() => {
    refetch()
    const interval = setInterval(refetch, REFRESH_INTERVAL)
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void refetch()
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refetch])

  const activeCount = projects.length

  return (
    <div className="container ap-active-projects">
      <div className="ap-active-projects-header">
        <h1 className="ap-active-projects-header-title">
          <MaterialIcon type="groups" />
          Active Projects
        </h1>
        <p className="ap-active-projects-header-desc">
          Real-time view of the projects currently being edited: who is
          working on what, straight from the editor service.
        </p>
      </div>

      {loadError ? (
        <div className="ap-status ap-status-error" role="alert">
          <MaterialIcon type="error" className="me-1" />
          {loadError}
        </div>
      ) : null}

      <div className="ap-settings-section">
        <div className="ap-settings-section-header ap-settings-section-header-actions">
          <span className="ap-settings-section-header-main">
            <span className="ap-settings-section-badge">1</span>
            Active projects
            {activeCount > 0 ? (
              <span className="ap-section-count">{activeCount}</span>
            ) : null}
          </span>
          <OLButton
            variant="secondary"
            size="sm"
            leadingIcon="refresh"
            disabled={busy}
            onClick={() => void refetch()}
            data-testid="ap-refresh"
          >
            Refresh
          </OLButton>
        </div>
        <div className="ap-settings-section-desc">
          Projects with at least one open editor connection. This list
          auto-refreshes every 30 s while the page is open
          {lastUpdated ? (
            <>
              {' '}
              (last updated {lastUpdated.toLocaleTimeString()})
            </>
          ) : null}
          .
        </div>
        <div className="ap-settings-section-body">
          {activeCount > 0 ? (
            <div className="ap-projects-list">
              {projects.map((project) => (
                <div
                  key={project.id}
                  className="ap-project-row"
                  data-ap-project-id={project.id}
                >
                  <div className="ap-project-main">
                    <div className="ap-project-name">
                      {project.activeUsers.some(u => u.email) ? (
                        <a
                          href={`mailto:${project.activeUsers
                            .map(u => u.email)
                            .filter(Boolean)
                            .join(',')}`}
                        >
                          {project.name}
                        </a>
                      ) : (
                        <span>{project.name}</span>
                      )}
                    </div>
                    <OLFormText className="ap-project-meta" marginless>
                      {project.connectionCount} editor connection
                      {project.connectionCount === 1 ? '' : 's'}
                    </OLFormText>
                  </div>
                  <div className="ap-project-users">
                    {project.activeUsers.length > 0 ? (
                      project.activeUsers.map((user, idx) => (
                        <div key={`${user.email || user.name}-${idx}`}>
                          {user.email ? (
                            <a href={`mailto:${user.email}`}>
                              {user.name || user.email}
                            </a>
                          ) : (
                            <span>{user.name}</span>
                          )}
                        </div>
                      ))
                    ) : (
                      <em>None detected</em>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="ap-empty">
              <MaterialIcon type="task_alt" className="ap-empty-icon" />
              <OLFormText marginless>
                Great news! No projects are currently being edited.
              </OLFormText>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default ActiveProjectsPage
