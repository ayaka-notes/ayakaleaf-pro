import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getUserFacingMessage, postJSON } from '@/infrastructure/fetch-json'
import useAsync from '@/shared/hooks/use-async'
import { CopyToClipboard } from '@/shared/components/copy-to-clipboard'
import OLButton from '@/shared/components/ol/ol-button'
import OLFormControl from '@/shared/components/ol/ol-form-control'
import OLFormSelect from '@/shared/components/ol/ol-form-select'
import OLFormSwitch from '@/shared/components/ol/ol-form-switch'
import OLNotification from '@/shared/components/notification'
import { DetailsTable } from '../../admin-user/details-table'
import { FullDate } from '../../admin-user/tabs/shared'
import { ProjectStatusBadge } from '../../shared/project-status'
import { getAdminProject } from '../meta'
import type { AdminProjectMeta } from '../types'

type Project = AdminProjectMeta['project']

// bytes as B, KB, MB, GB
function formatSize(bytes: number) {
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${units[unit]}`
}

// the editor's compiler menu (compiler-setting.tsx)
const COMPILERS = ['pdfLaTeX', 'LaTeX', 'XeLaTeX', 'LuaLaTeX']
// the docs the editor offers as main document
const MAIN_DOC = /\.(tex|ltx|rtex|rnw)$/i

type Form = {
  name: string
  compiler: string
  imageName: string
  rootDocId: string
  linkSharing: boolean
}

const formFrom = (project: Project): Form => ({
  name: project.name,
  compiler: project.compiler ?? '',
  imageName: project.imageName ?? '',
  rootDocId: project.rootDocId ?? '',
  linkSharing: project.linkSharing,
})

// The project's details, as the original admin page's Project Info; the
// pencil in the page header edits them through core's own project settings
// endpoints (the editor's settings menu); a deleted project adds when and by
// whom
function OverviewTab({
  project,
  onSaved,
  editing,
  onEditingChange,
  onChangeOwner,
}: {
  project: Project
  onSaved: (project: Project) => void
  editing: boolean
  onEditingChange: (editing: boolean) => void
  onChangeOwner: () => void
}) {
  const { t } = useTranslation()
  const {
    owner,
    ownerId,
    deleter,
    imageNames = [],
    linkSharingEnabled,
  } = getAdminProject()
  const ownerKey = owner?.id ?? ownerId
  const [form, setForm] = useState<Form>(() => formFrom(project))
  const { isLoading, isSuccess, isError, error, runAsync, reset } = useAsync()

  const change = (update: Partial<Form>) => {
    reset()
    setForm(prev => ({ ...prev, ...update }))
  }

  const settings: Record<string, string> = {}
  if (form.name.trim() !== project.name) settings.name = form.name.trim()
  if (form.compiler !== (project.compiler ?? '')) settings.compiler = form.compiler
  if (form.imageName !== (project.imageName ?? '')) settings.imageName = form.imageName
  if (form.rootDocId !== (project.rootDocId ?? '')) settings.rootDocId = form.rootDocId
  const linkSharingChanged = form.linkSharing !== project.linkSharing
  const dirty = Object.keys(settings).length > 0 || linkSharingChanged

  const docs = project.entries.filter(
    entry => entry.type === 'doc' && MAIN_DOC.test(entry.path)
  )
  // the current image stays selectable when the site no longer offers it,
  // as in the editor
  const images = imageNames.some(image => image.imageName === project.imageName)
    ? imageNames
    : [
        ...imageNames,
        ...(project.imageName
          ? [{ imageName: project.imageName, imageDesc: project.imageName }]
          : []),
      ]

  const save = () => {
    runAsync(
      (async () => {
        if (Object.keys(settings).length > 0) {
          await postJSON(`/project/${project.id}/settings`, { body: settings })
        }
        if (linkSharingChanged) {
          await postJSON(`/project/${project.id}/settings/admin`, {
            body: { publicAccessLevel: form.linkSharing ? 'tokenBased' : 'private' },
          })
        }
      })()
    )
      .then(() => {
        const saved: Project = {
          ...project,
          name: form.name.trim(),
          compiler: form.compiler,
          imageName: form.imageName,
          texLiveVersion:
            images.find(image => image.imageName === form.imageName)?.imageDesc ??
            form.imageName,
          rootDocId: form.rootDocId,
          mainDocument: docs.find(doc => doc.id === form.rootDocId)?.path,
          linkSharing: form.linkSharing,
        }
        onSaved(saved)
        setForm(formFrom(saved))
        onEditingChange(false)
      })
      .catch(() => {})
  }

  const cancel = () => {
    reset()
    setForm(formFrom(project))
    onEditingChange(false)
  }

  const select = (
    key: 'compiler' | 'imageName' | 'rootDocId',
    options: { value: string; label: string; disabled?: boolean }[]
  ) => (
    <OLFormSelect
      key={key}
      id={`admin-project-${key}`}
      className="admin-panel-input"
      size="sm"
      value={form[key]}
      onChange={event => change({ [key]: event.target.value })}
    >
      {options.map(option => (
        <option
          key={option.value}
          value={option.value}
          disabled={option.disabled}
        >
          {option.label}
        </option>
      ))}
    </OLFormSelect>
  )

  const rows: [string, React.ReactNode][] = [
    [
      'ID',
      // core's copy button, as the share modal's copy link
      <span key="id" className="admin-panel-copy">
        <code>{project.id}</code>
        <CopyToClipboard content={project.id} tooltipId="admin-project-copy-id" />
      </span>,
    ],
    [
      t('name'),
      editing ? (
        <OLFormControl
          key="name"
          id="admin-project-name"
          className="admin-panel-input"
          size="sm"
          maxLength={150}
          value={form.name}
          onChange={event => change({ name: event.target.value })}
        />
      ) : (
        project.name
      ),
    ],
    [
      t('owner'),
      ownerKey ? (
        <div key="owner" className="admin-panel-inline-field">
          <a className="admin-panel-plain-link" href={`/admin/user/${ownerKey}`}>
            {owner?.email ?? ownerKey}
          </a>
          {/* a transfer notifies both owners and cannot be undone, so it is
              confirmed on its own, not saved with the form */}
          {editing && (
            <OLButton variant="secondary" size="sm" onClick={onChangeOwner}>
              {t('change_project_owner')}
            </OLButton>
          )}
        </div>
      ) : null,
    ],
    [t('status'), <ProjectStatusBadge key="status" status={project.status} />],
    [t('created'), <FullDate key="created" date={project.createdAt} />],
    [t('last_modified'), <FullDate key="modified" date={project.lastUpdated} />],
    // core lets site admins turn it on and off (canUserAdminProject), but
    // gives the links only to the owner; without link sharing core answers 403
    ...(linkSharingEnabled
      ? ([
          [
            t('link_sharing'),
            editing ? (
              <OLFormSwitch
                key="link-sharing"
                id="admin-project-link-sharing"
                label={t('link_sharing')}
                checked={form.linkSharing}
                onChange={event => change({ linkSharing: event.target.checked })}
              />
            ) : project.linkSharing ? (
              t('link_sharing_is_on')
            ) : (
              t('link_sharing_is_off_short')
            ),
          ],
        ] as [string, React.ReactNode][])
      : []),
    [
      t('compiler'),
      editing
        ? select(
            'compiler',
            COMPILERS.map(label => ({ value: label.toLowerCase(), label }))
          )
        : COMPILERS.find(label => label.toLowerCase() === project.compiler) ??
          project.compiler,
    ],
    [
      t('tex_live_version'),
      editing
        ? select(
            'imageName',
            images.map(({ imageName, imageDesc }) => ({
              value: imageName,
              label: imageDesc,
            }))
          )
        : project.texLiveVersion,
    ],
    [
      t('main_document'),
      editing
        ? select(
            'rootDocId',
            // as core's main document setting: without one, None shows first
            [
              ...(project.rootDocId
                ? []
                : [{ value: '', label: 'None', disabled: true }]),
              ...docs.map(doc => ({ value: doc.id ?? '', label: doc.path })),
            ]
          )
        : project.mainDocument,
    ],
    [t('size'), project.size != null ? formatSize(project.size) : null],
  ]
  if (project.status === 'deleted') {
    rows.push(
      [t('deleted_at'), <FullDate key="deleted" date={project.deletedAt} />],
      [
        t('deleted_by_email'),
        deleter?.id ? (
          <a key="deleter" className="admin-panel-plain-link" href={`/admin/user/${deleter.id}`}>
            {deleter.email ?? deleter.id}
          </a>
        ) : null,
      ],
      [t('deleted_by_ip'), deleter?.ipAddress]
    )
  }

  return (
    <>
      <DetailsTable rows={rows} />
      {/* Cancel and Save centred under the table, as on the user page */}
      {editing && (
        <div className="admin-panel-form-actions">
          <OLButton variant="secondary" onClick={cancel} disabled={isLoading}>
            {t('cancel')}
          </OLButton>
          <OLButton
            variant="primary"
            onClick={save}
            disabled={!dirty || !form.name.trim()}
            isLoading={isLoading}
            loadingLabel={t('saving')}
          >
            {t('save')}
          </OLButton>
        </div>
      )}
      {isSuccess && !editing && (
        <p className="text-success text-center mt-3 mb-0" aria-live="polite">
          {t('saved')}
        </p>
      )}
      {isError && (
        <OLNotification
          type="error"
          className="mt-3"
          content={getUserFacingMessage(error) ?? t('generic_something_went_wrong')}
        />
      )}
    </>
  )
}

export default OverviewTab
