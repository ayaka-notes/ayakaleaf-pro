import { useTranslation } from 'react-i18next'
import { useState, useEffect } from 'react'
import useAsync from '@/shared/hooks/use-async'
import { debugConsole } from '@/utils/debugging'
import {
  getJSON,
  postJSON
} from '@/infrastructure/fetch-json'
import {
  OLModalBody,
  OLModalFooter,
} from '@/shared/components/ol/ol-modal'
import Notification from '@/shared/components/notification'
import OLButton from '@/shared/components/ol/ol-button'
import OLForm from '@/shared/components/ol/ol-form'
import OLFormGroup from '@/shared/components/ol/ol-form-group'
import OLFormControl from '@/shared/components/ol/ol-form-control'
import OLFormLabel from '@/shared/components/ol/ol-form-label'
import OLFormCheckbox from '@/shared/components/ol/ol-form-checkbox'
import OLFormSelect from '@/shared/components/ol/ol-form-select'
import OLRow from '@/shared/components/ol/ol-row'
import OLCol from '@/shared/components/ol/ol-col'
import { GitSyncModalStatus } from '../../types/git-sync-types'

type OrgsResponse = {
  user: string
  orgs: string[]
}

type GitSyncExportModalProps = {
  projectId: string
  projectName: string
  handleHide: () => void
  setModalStatus: (modalStatus: GitSyncModalStatus) => void
}

const GitSyncExportModal = ({
  projectId,
  projectName,
  handleHide,
  setModalStatus
}: GitSyncExportModalProps) => {
  const { t } = useTranslation()

  const [selectedOwner, setSelectedOwner] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [repoName, setRepoName] = useState(projectName)
  const [description, setDescription] = useState('')
  const [visibility, setVisibility] = useState<'public' | 'private'>('private')

  const {
    runAsync: runAsyncUserAndOrgs,
    data: userAndOrgs,
    error: errorUserAndOrgs
  } = useAsync<OrgsResponse>()

  useEffect(() => {
    runAsyncUserAndOrgs(getJSON('/user/github-sync/orgs'))
      .then(userAndOrgs => setSelectedOwner(userAndOrgs?.user))
      .catch(err => debugConsole.error(err?.data?.message || err?.message || err))
  }, [])

  const { isLoading, error, setError, runAsync } = useAsync<void>()

  // Static mapping of the error keys, for i18n.
  const GITHUB_ERROR_MESSAGES: Record<string, string> = {
    github_validation_check: t('github_validation_check'),
  }

  const createRepo = () => {
    const isPublic = visibility === 'public'
    const org = selectedOwner === userAndOrgs?.user ? undefined : selectedOwner

    runAsync(postJSON(`/project/${projectId}/github-sync/export`, {
      body: {
        name: repoName,
        description,
        isPublic,
        org,
      },
    }))
      .then(() => setModalStatus('loading'))
      .catch(err => {
        debugConsole.error(err?.data?.message || err?.message || err)
        setError(
          GITHUB_ERROR_MESSAGES[err?.data?.key] ??
            t('something_went_wrong_server')
        )
      })
  }

  return (
    <>
      <OLModalBody>
        <h4>{t('export_project_to_github')}</h4>
        <p>{t('project_not_linked_to_github')}</p>

        {error && (
          <div className="notification-list">
            <Notification
              type="error"
              content={error}
            />
          </div>
        )}

        {errorUserAndOrgs && (
          <div className="notification-list">
            <Notification
              type="error"
              content={t('something_went_wrong_server')}
            />
          </div>
        )}

        <OLForm onSubmit={createRepo}>
          <OLRow>
            <OLCol xs={4}>
              <OLFormGroup>
                <OLFormLabel htmlFor="github-sync-owner">
                  {selectedOwner === userAndOrgs?.user
                    ? t('owner')
                    : t('organization')}
                </OLFormLabel>
                <OLFormSelect
                  id="github-sync-owner"
                  name="org"
                  value={selectedOwner}
                  onChange={e => setSelectedOwner(e.target.value)}
                >
                  <option key={userAndOrgs?.user} value={userAndOrgs?.user}>
                    {userAndOrgs?.user}
                  </option>
                  {userAndOrgs?.orgs.map(org => (
                    <option key={org} value={org}>
                      {org}
                    </option>
                  ))}
                </OLFormSelect>
              </OLFormGroup>
            </OLCol>

            <OLCol xs={5}>
              <OLFormGroup>
                <OLFormLabel htmlFor="github-sync-name">
                  {t('repository_name')}
                </OLFormLabel>
                <OLFormControl
                  id="github-sync-name"
                  name="name"
                  type="text"
                  value={repoName}
                  onChange={e => setRepoName(e.target.value)}
                />
              </OLFormGroup>
            </OLCol>
          </OLRow>

          <OLRow>
            <OLCol xs={12}>
              <OLFormGroup>
                <OLFormLabel htmlFor="github-sync-description">
                  {t('description')} ({t('optional')})
                </OLFormLabel>
                <OLFormControl
                  id="github-sync-description"
                  name="description"
                  type="text"
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                />
              </OLFormGroup>
            </OLCol>
          </OLRow>

          <hr />

          <fieldset>
            <legend className="visually-hidden">
              {t('repository_visibility')}
            </legend>

            <OLFormGroup>
              <OLRow>
                <OLCol xs={12}>
                  <OLFormCheckbox
                    type="radio"
                    id="public"
                    name="repository"
                    value="public"
                    checked={visibility === 'public'}
                    onChange={() => setVisibility('public')}
                    label={t('public', { defaultValue: 'Public' })}
                    description={t('github_public_description')}
                  />
                </OLCol>
              </OLRow>

              <OLRow>
                <OLCol xs={12}>
                  <OLFormCheckbox
                    className="mr-1"
                    type="radio"
                    id="private"
                    name="repository"
                    value="private"
                    checked={visibility === 'private'}
                    onChange={() => setVisibility('private')}
                    label={t('private', { defaultValue: 'Private' })}
                    description={t('github_private_description')}
                  />
                </OLCol>
              </OLRow>
            </OLFormGroup>
          </fieldset>
        </OLForm>
      </OLModalBody>

      <OLModalFooter>
        <OLButton
          variant="secondary"
          onClick={handleHide}
        >
          {t('cancel')}
        </OLButton>

        <OLButton
          variant="primary"
          onClick={createRepo}
          disabled={!repoName.trim() || isLoading}
          isLoading={isLoading}
        >
          {t('create_project_in_github')}
        </OLButton>
      </OLModalFooter>
    </>
  )
}

export default GitSyncExportModal
