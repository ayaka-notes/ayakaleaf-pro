import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import getMeta from '@/utils/meta'
import {
    OLModal,
    OLModalBody,
    OLModalFooter,
    OLModalHeader,
    OLModalTitle,
} from '@/shared/components/ol/ol-modal'
import OLButton from '@/shared/components/ol/ol-button'
import OLNotification from '@/shared/components/ol/ol-notification'
import { getJSON, postJSON } from '@/infrastructure/fetch-json'
import { debugConsole } from '@/utils/debugging'

type WebdavUserStatus = {
    connected: boolean
    baseUrl?: string
    rootPath?: string
    username?: string
}

// Optional status fields for projects
type ProjectWebdavStatus = WebdavUserStatus & {
    lastSyncAt?: string | null
    mergeStatus?: string
    lastConflict?: {
        path?: string | null
        localVersion?: string
        remoteVersion?: string
        timestamp?: string
    } | null
}

type ProjectInfo = {
    projectName?: string
}

const getProjectNameEndpoint = (projectId: string) => `/project/${projectId}/webdav/project-name`

function WebdavSyncModal({ show, handleHide, projectId, initialProjectName }: {
    show: boolean
    handleHide: () => void
    projectId: string
    initialProjectName?: string
}) {
    const { t } = useTranslation()
    const [modalStatus, setModalStatus] = useState<'loading' | 'disconnected' | 'notLinkedProject' | 'connected'>('loading')
    const [status, setStatus] = useState<ProjectWebdavStatus>()
    const [projectName, setProjectName] = useState<string>()
    const [working, setWorking] = useState(false)

    // Initialize: fetch user connection and project state on first load
    useEffect(() => {
        if (!show) return

        // Set initial project name from parent component
        if (initialProjectName) {
            setProjectName(initialProjectName)
        }

        // First check if user has WebDAV account linked at /user/webdav/status
        getJSON('/user/webdav/status')
            .then((userData: WebdavUserStatus) => {
                setStatus(userData)
                if (!userData.connected) {
                    setModalStatus('disconnected')
                    return
                }
                // Then fetch project state and name from correct endpoint
                getJSON('/project/' + projectId + '/webdav/state')
                    .then((data: ProjectWebdavStatus) => {
                        setStatus(data)
                        
                        if (!data.connected) {
                            // Project is not linked to WebDAV - set status and use initial project name
                            setModalStatus('notLinkedProject')
                            return
                        }
                        
                        // Project IS linked to WebDAV - try to get the project name from WebDAV endpoint
                        return getJSON(getProjectNameEndpoint(projectId))
                            .then((projName: ProjectInfo | string) => {
                                const projectName = typeof projName === 'string' ? projName : (projName?.projectName || initialProjectName || `project_${projectId}`)
                                setProjectName(projectName)
                                setModalStatus('connected')
                            })
                            .catch(() => {
                                // Fallback name if project-name endpoint fails
                                setProjectName(initialProjectName || `project_${projectId}`)
                                setModalStatus('connected')
                            })
                    })
                    .catch((err: any) => {
                        debugConsole.error(err?.message || err)
                        setStatus({ connected: false } as ProjectWebdavStatus)
                        setModalStatus('notLinkedProject')
                        // Use initial project name if fetch fails (from parent component)
                        if (!initialProjectName) {
                            setProjectName(`project_${projectId}`)
                        }
                    })
            })
            .catch((err: any) => {
                debugConsole.error(err?.message || err)
                setStatus({ connected: false } as WebdavUserStatus)
                setModalStatus('disconnected')
            })
    }, [show, projectId, initialProjectName])

    // Unlink project from WebDAV
    const handleUnlinkProject = async () => {
        setWorking(true)
        try {
            const res = await fetch(`/project/${projectId}/webdav/state`, { 
                method: 'DELETE',
                headers: {
                    'X-Csrf-Token': getMeta('ol-csrfToken'),
                    'Content-Type': 'application/json'
                },
                credentials: 'same-origin'
            })

            let data: { message?: string; error?: string } = {}
            try { data = await res.json() } catch { /* non-JSON body */ }

            // D.4 / H7: only proceed to the "unlinked" UI when the server
            // confirmed (ok, or 404 = never linked). A failed unlink (500 etc.)
            // must NOT flip the UI to "unlinked".
            if (!res.ok && res.status !== 404) {
                debugConsole.error(`WebDAV unlink failed (${res.status})`, data)
                alert(t('failed_to_unlink_webdav', { fallback: data.message || data.error || 'Unknown error' }))
                return
            }

            setStatus({ connected: false } as ProjectWebdavStatus)
            setModalStatus('notLinkedProject')
        } catch (err: any) {
            debugConsole.error(err?.message || err)
            alert(t('failed_to_unlink_webdav', { fallback: err?.message || 'Unknown error' }))
        } finally {
            setWorking(false)
        }
    }

    // Resolve a sync conflict: push the kept version to the remote (or apply
    // the remote version locally) via the backend resolver, then refetch state.
    const handleResolveConflict = async (choice: 'local' | 'remote') => {
        const path = (status as ProjectWebdavStatus | undefined)?.lastConflict?.path
        if (!path) return
        setWorking(true)
        try {
            await postJSON(`/project/${projectId}/webdav/conflict/resolve`, {
                body: { path, choice }
            })
            const data = await getJSON('/project/' + projectId + '/webdav/state')
            setStatus(data as ProjectWebdavStatus)
        } catch (err: any) {
            debugConsole.error(err?.message || err)
            alert(err?.data?.message || err?.message || t('generic_something_went_wrong'))
        } finally {
            setWorking(false)
        }
    }

    // Link project to WebDAV
    const handleLinkProject = async () => {
        setWorking(true)
        try {
            // Get user's current WebDAV status (baseUrl, rootPath)
            const userData: WebdavUserStatus | null = await getJSON('/user/webdav/status')
            if (!userData?.connected) {
                throw new Error(t('webdav_credentials_not_found'))
            }

            // Create project sync state with user's WebDAV configuration
            await postJSON(`/project/${projectId}/webdav/link`, {
                body: {
                    baseUrl: userData.baseUrl || '',
                    rootPath: userData.rootPath || '',
                    username: userData.username || '',
                    password: userData.password || ''
                }
            })

            // Refresh status after linking
            const updatedStatus = await getJSON('/project/' + projectId + '/webdav/state')
            setStatus(updatedStatus)
            setModalStatus('connected')
        } catch (err: any) {
            debugConsole.error(err?.message || err)
            alert(t('failed_to_link_webdav', { fallback: 'Failed to link project to WebDAV: Unknown error' }))
        } finally {
            setWorking(false)
        }
    }

    const handlePoll = () => {
        setWorking(true)
        postJSON('/project/' + projectId + '/webdav/pull')
            .then(() => {
                // Refresh status after pull
                getJSON('/project/' + projectId + '/webdav/state').then((data) => {
                    setStatus(data)
                    alert(t('webdav_pull_success', { fallback: 'Successfully imported from WebDAV' }))
                })
            })
            .catch((err: any) => {
                debugConsole.error(err?.message || err)
                alert(t('webdav_pull_failed', { fallback: 'Failed to import from WebDAV: ' }) + (err?.data?.message || err?.message || t('generic_something_went_wrong')))
            })
            .finally(() => setWorking(false))
    }

    const handlePush = () => {
        setWorking(true)
        postJSON('/project/' + projectId + '/webdav/push')
            .then(() => {
                // Refresh status after push
                getJSON('/project/' + projectId + '/webdav/state').then((data) => {
                    setStatus(data)
                    alert(t('webdav_push_success', { fallback: 'Successfully exported to WebDAV' }))
                })
            })
            .catch((err: any) => {
                debugConsole.error(err?.message || err)
                alert(t('webdav_push_failed', { fallback: 'Failed to export to WebDAV: ' }) + (err?.data?.message || err?.message || t('generic_something_went_wrong')))
            })
            .finally(() => setWorking(false))
    }

    const handleClose = () => {
        handleHide()
        setModalStatus('loading')
        setStatus(undefined)
    }

    if (modalStatus === 'loading') {
        return (
            <OLModal show={show} onHide={handleClose}>
                <OLModalHeader>
                    <OLModalTitle>{t('webdav')}</OLModalTitle>
                </OLModalHeader>
                <OLModalBody>
                    <p>{t('loading')}...</p>
                </OLModalBody>
            </OLModal>
        )
    }

    // If user account not linked, show "link your account" message
    if (modalStatus === 'disconnected') {
        return (
            <OLModal show={show} onHide={handleClose}>
                <OLModalHeader>
                    <OLModalTitle>{t('webdav')}</OLModalTitle>
                </OLModalHeader>
                <OLModalBody>
                    <p className="small">
                        {t('sync_with_a_webdav_server')}{' '}
                        <a href="/user/settings" target="_blank" rel="noreferrer">
                            {t('link_your_account')}
                        </a>
                    </p>
                </OLModalBody>
            </OLModal>
        )
    }

    // Project not linked to WebDAV but user account is connected
    const remoteFolderPath = status?.rootPath && projectName ? status.rootPath + '/' + projectName : null
    if (modalStatus === 'notLinkedProject') {
        return (
            <OLModal show={show} onHide={handleClose}>
                <OLModalHeader>
                    <OLModalTitle>{t('webdav')}</OLModalTitle>
                </OLModalHeader>
                <OLModalBody>
                    {status?.baseUrl && (
                        <p className="small">
                            <strong>{t('connected_to')}:</strong> {status.baseUrl}
                        </p>
                    )}
                    {remoteFolderPath && (
                        <p className="small">
                            <strong>{t('webdav_root_path_label')}:</strong> {remoteFolderPath}
                        </p>
                    )}
                    <p className="small mt-2 mb-3">
                        {t('this_project_is_not_linked_to_webdav')}
                    </p>
                    {projectName && (
                        <div className="mb-3">
                            <strong>{t('project_name_label')} </strong> {projectName}
                        </div>
                    )}
                    <OLButton variant="secondary" onClick={() => handleLinkProject()} disabled={working}>
                        {working ? t('loading') : t('webdav_link_project_button')}
                    </OLButton>
                </OLModalBody>
            </OLModal>
        )
    }

    // Connected state (both user and project linked) - show sync options
    const connectedStatus = status as ProjectWebdavStatus & { lastSyncAt?: string | null }
    // remoteFolderPath is already declared earlier, we still need it here

    if (modalStatus === 'connected') {
        return (
            <OLModal show={show} onHide={handleClose}>
                <OLModalHeader>
                    <OLModalTitle>{t('webdav')}</OLModalTitle>
                </OLModalHeader>

                <OLModalBody>
                    {status?.baseUrl && status.connected && (
                        <>
                            <p className="small">
                                <strong>{t('connected_to')}:</strong> {status.baseUrl}
                            </p>

                            {remoteFolderPath && (
                                <p className="small">
                                    <strong>{t('webdav_root_path_label')}:</strong> {remoteFolderPath}
                                </p>
                            )}

                            {connectedStatus.lastSyncAt && (
                                <p className="small">
                                    <strong>{t('last_synced')}:</strong>{' '}
                                    {new Date(connectedStatus.lastSyncAt).toLocaleString()}
                                </p>
                            )}

                            {/* D.4: conflict view — both sides changed since last sync */}
                            {connectedStatus.mergeStatus === 'conflict' && (
                                <div className="mb-3">
                                    <OLNotification type="warning" content={t('webdav_conflict_title')} />
                                    <p className="small">{t('webdav_conflict_detail')}</p>
                                    {connectedStatus.lastConflict?.path && (
                                        <p className="small">
                                            <code>{connectedStatus.lastConflict.path}</code>
                                        </p>
                                    )}
                                    {connectedStatus.lastConflict?.path && (
                                        <div className="d-flex gap-2">
                                            <OLButton
                                                variant="secondary"
                                                onClick={() => handleResolveConflict('local')}
                                                disabled={working}
                                            >
                                                {t('webdav_conflict_keep_local_button')}
                                            </OLButton>
                                            <OLButton
                                                variant="primary"
                                                onClick={() => handleResolveConflict('remote')}
                                                disabled={working}
                                            >
                                                {t('webdav_conflict_keep_remote_button')}
                                            </OLButton>
                                        </div>
                                    )}
                                </div>
                            )}

                            <div className="d-flex gap-2 mt-3 mb-3">
                                <OLButton variant="secondary" onClick={handlePoll} disabled={working}>
                                    {working ? t('loading') : t('webdav_import_from_webdav')}
                                </OLButton>
                                <OLButton variant="primary" onClick={handlePush} disabled={working}>
                                    {working ? t('loading') : t('webdav_export_to_webdav')}
                                </OLButton>
                            </div>
                            <p className="small text-muted">
                                {t('webdav_import_note')}
                            </p>
                            <p className="small text-muted mb-2">
                                {t('webdav_export_note')}
                            </p>

                            {/* Unlink button */}
                            <OLButton
                                variant="danger-ghost"
                                onClick={handleUnlinkProject}
                                disabled={working}
                            >
                                {t('webdav_unlink_button')}
                            </OLButton>
                            <p className="small text-muted">
                                {t('webdav_unlink_note')}
                            </p>
                        </>
                    )}
                </OLModalBody>

                <OLModalFooter>
                    <OLButton variant="secondary" onClick={handleClose}>
                        {t('close')}
                    </OLButton>
                </OLModalFooter>
            </OLModal>
        )
    }

    // Fallback for any other state
    return null
}

export default WebdavSyncModal