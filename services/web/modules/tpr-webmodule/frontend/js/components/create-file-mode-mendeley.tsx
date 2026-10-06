import { useTranslation } from 'react-i18next'
import { FormEventHandler, useEffect, useState, useCallback } from 'react'
import { getJSON } from '@/infrastructure/fetch-json'
import { useFileTreeActionable } from '@/features/file-tree/contexts/file-tree-actionable'
import { useFileTreeCreateForm } from '@/features/file-tree/contexts/file-tree-create-form'
import { useFileTreeMainContext } from '@/features/file-tree/contexts/file-tree-main'
import FileTreeModalCreateFileMode from '@/features/file-tree/components/file-tree-create/file-tree-modal-create-file-mode'
import ErrorMessage from '@/features/file-tree/components/file-tree-create/error-message'
import OLFormGroup from '@/shared/components/ol/ol-form-group'
import OLFormLabel from '@/shared/components/ol/ol-form-label'
import OLFormControl from '@/shared/components/ol/ol-form-control'
import OLFormSelect from '@/shared/components/ol/ol-form-select'
import Notification from '@/shared/components/notification'
import useInstanceFeatures from '@modules/instance-features/frontend/js/use-instance-features'

type MendeleyGroup = {
  id: string
  name: string
}

export function CreateFileMode() {
  const { t } = useTranslation()
  const { mendeley } = useInstanceFeatures()
  const { refProviders } = useFileTreeMainContext()
  const isLinked = (refProviders as Record<string, boolean>)?.mendeley

  if (!mendeley || !isLinked) {
    return null
  }

  return (
    <FileTreeModalCreateFileMode
      mode="mendeley"
      icon="library_books"
      label={t('from_provider', { provider: 'Mendeley' })}
    />
  )
}

export function CreateFilePane() {
  const { mendeley } = useInstanceFeatures()
  const { newFileCreateMode } = useFileTreeActionable()

  if (!mendeley || newFileCreateMode !== 'mendeley') {
    return null
  }

  return <MendeleyCreateFilePane />
}

function MendeleyCreateFilePane() {
  const { t } = useTranslation()
  const { setValid } = useFileTreeCreateForm()
  const { finishCreatingLinkedFile, error, inFlight } = useFileTreeActionable()

  const [groups, setGroups] = useState<MendeleyGroup[]>([])
  const [selectedGroupId, setSelectedGroupId] = useState<string>('')
  const [name, setName] = useState('mendeley.bib')
  const [loadingGroups, setLoadingGroups] = useState(true)
  const [groupsError, setGroupsError] = useState('')

  useEffect(() => {
    setValid(!!name && !loadingGroups)
  }, [setValid, name, loadingGroups])

  useEffect(() => {
    let cancelled = false

    setLoadingGroups(true)
    setGroupsError('')

    getJSON('/mendeley/groups')
      .then((data: { groups: MendeleyGroup[] }) => {
        if (cancelled) return

        setGroups(data.groups || [])
        setLoadingGroups(false)
      })
      .catch(err => {
        if (cancelled) return

        // The server answers 403 when the stored credentials no longer work,
        // which the user can only fix by relinking.
        setGroupsError(
          err?.response?.status === 403
            ? t('mendeley_groups_relink')
            : t('mendeley_groups_loading_error')
        )
        setLoadingGroups(false)
      })

    return () => {
      cancelled = true
    }
  }, [t])

  const handleSubmit: FormEventHandler = useCallback(
    event => {
      event.preventDefault()

      if (!name || loadingGroups || inFlight) {
        return
      }

      const data: Record<string, string> = {}

      if (selectedGroupId) {
        data.group_id = selectedGroupId
      }

      finishCreatingLinkedFile({
        name,
        provider: 'mendeley',
        data,
      }).then(result => {
        // Reindex the references here and, through the broadcast, for the
        // collaborators; undefined when creating the file failed
        if (result) window.dispatchEvent(new CustomEvent('reference:added'))
      })
    },
    [
      name,
      loadingGroups,
      inFlight,
      selectedGroupId,
      finishCreatingLinkedFile,
    ]
  )

  return (
    <form
      className="form-controls"
      id="create-file"
      noValidate
      onSubmit={handleSubmit}
    >
      {groupsError && (
        <div className="notification-list">
          <Notification type="error" content={groupsError} className="mb-3" />
        </div>
      )}

      <OLFormGroup controlId="mendeley-file-name">
        <OLFormLabel>{t('file_name')}</OLFormLabel>
        <OLFormControl
          type="text"
          placeholder="mendeley.bib"
          required
          value={name}
          disabled={inFlight}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setName(e.target.value)
          }
        />
      </OLFormGroup>

      <OLFormGroup controlId="mendeley-library-select">
        <OLFormLabel>{t('library')}</OLFormLabel>
        {loadingGroups ? (
          <p className="text-muted">{t('loading')}...</p>
        ) : (
          <OLFormSelect
            id="mendeley-library-select"
            value={selectedGroupId}
            disabled={inFlight}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
              setSelectedGroupId(e.target.value)
            }
          >
            <option value="">{t('my_library')}</option>
            {groups.map(g => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </OLFormSelect>
        )}
      </OLFormGroup>

      {error && <ErrorMessage error={error} />}
    </form>
  )
}
