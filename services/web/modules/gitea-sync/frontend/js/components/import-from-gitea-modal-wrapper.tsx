import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import useAsync from '@/shared/hooks/use-async'
import { debugConsole } from '@/utils/debugging'
import {
  postJSON,
  getJSON,
} from '@/infrastructure/fetch-json'
import getMeta from '@/utils/meta'
import useInstanceFeatures from '@modules/instance-features/frontend/js/use-instance-features'
import {
  OLModal,
  OLModalBody,
  OLModalFooter,
  OLModalHeader,
  OLModalTitle,
} from '@/shared/components/ol/ol-modal'
import OLButton from '@/shared/components/ol/ol-button'
import OLSpinner from '@/shared/components/ol/ol-spinner'
import Notification from '@/shared/components/notification'
import { GitSyncExposedSettings } from '../types/git-sync-types'

type GitSyncRepo = {
  name: string
  fullName: string
  defaultBranchName: string
}

type GitSyncReposResponse = {
  repos?: GitSyncRepo[]
}

function ImportFromGiteaModalContent({ handleHide }: { handleHide: () => void }) {
  const { t } = useTranslation()
  const { appName, giteaUrl } = getMeta('ol-ExposedSettings') as GitSyncExposedSettings

  const {
    isLoading,
    isSuccess,
    isError,
    data,
    runAsync,
  } = useAsync<GitSyncReposResponse>()

  useEffect(() => {
    runAsync(getJSON('/user/gitea-sync/repos'))
      .catch(err => debugConsole.error(err?.data?.message || err?.message || err))
  }, [runAsync])

  const reposExist = data?.repos != null
  const repos = reposExist ? data.repos : []

  const {
    isLoading: isImporting,
    isSuccess: isImported,
    isError: isErrorImport,
    runAsync: runAsyncImport,
  } = useAsync<{ projectId: string }>()

  useEffect(() => {
    if (isImported) {
      handleHide()
    }
  }, [handleHide, isImported])

  const showLinkToGitea = !isImporting && isSuccess && !reposExist
  const showRepos = !isImporting && isSuccess && reposExist

  const handleImport = (repo: GitSyncRepo) => {

    runAsyncImport(
      postJSON('/project/new/gitea-sync', {
        body: repo
      })
    )
      .then(data => {
        window.location.href = `/project/${data.projectId}`
      })
      .catch(err => debugConsole.error(err?.data?.message || err?.message || err))
  }

  return (
    <>
      <OLModalHeader onClose={handleHide}>
        <OLModalTitle>{t('import_from_x', { provider: 'Gitea' })}</OLModalTitle>
      </OLModalHeader>

      <OLModalBody>
        {isLoading && (
          <span>
            <OLSpinner size="sm" className="me-2"/>
            {t('loading_x_repositories', { provider: 'Gitea' })}
          </span>
        )}

        {isImporting && (
          <span>
            <OLSpinner size="sm" className="me-2"/>
            {t('importing')}
          </span>
        )}

        {isError && (
          <div className="notification-list">
            <Notification
              type="error"
              content={t('something_went_wrong_server')}
            />
          </div>
        )}

        {showLinkToGitea && (
          <div className="text-center">
            <p>
              {t('link_to_x_description', { provider: 'Gitea', appName })}
            </p>
            <OLButton
              variant="secondary"
              href="/user/gitea-sync/oauth2"
            >
              {t('link_to_x', { provider: 'Gitea' })}
            </OLButton>
          </div>
        )}

        {showRepos && (
          <div>
            {repos.length === 0 ? (
              <p className="text-center">
                {t('you_dont_have_any_repositories')}
              </p>
            ) : (
              <>
                <p className="text-center">
                  {t('select_x_repository', { provider: 'Gitea', appName })}
                </p>
                <div className="table-container table-container-bordered">
                  <table className="table table-striped table-hover">
                    <tbody>
                      {repos.map(repo => (
                        <tr key={repo.fullName}>
                          <td>
                            {repo.name}
                            <div className="small">
                              <a
                                href={`${giteaUrl}/${repo.fullName}`}
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                {repo.fullName}
                              </a>
                            </div>
                          </td>
                          <td className="text-end">
                            <OLButton
                              variant="primary"
                              onClick={() => handleImport(repo)}
                            >
                              {t('import_to_sharelatex', { appName: 'Overleaf' })}
                            </OLButton>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}

        {isErrorImport && (
          <div className="notification-list">
            <Notification
              type="error"
              content={t('something_went_wrong_server')}
            />
          </div>
        )}

      </OLModalBody>

      <OLModalFooter>
        <OLButton
          variant="secondary"
          onClick={handleHide}
          disabled={isImporting}
        >
          {t('cancel')}
        </OLButton>
      </OLModalFooter>
    </>
  )
}

export default function ImportFromGiteaModal({ onHide }: { onHide: () => void }) {
  const { giteaSync } = useInstanceFeatures()
  if (!giteaSync) {
    return null
  }
  return (
    <OLModal
      id="git-import-modal"
      show
      animation
      size="lg"
      onHide={onHide}
      backdrop="static"
    >
      <ImportFromGiteaModalContent handleHide={onHide} />
    </OLModal>
  )
}
