import _ from 'lodash'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import OLIconButton from '@/shared/components/ol/ol-icon-button'
import OLTooltip from '@/shared/components/ol/ol-tooltip'
import OLButtonGroup from '@/shared/components/ol/ol-button-group'
import OLButtonToolbar from '@/shared/components/ol/ol-button-toolbar'
import { ConfirmModal, type Action } from '../admin-users/components/user-actions'
import {
  changeOwnerAction,
  projectActions,
  type ProjectStatus,
} from './project-status'
import { runEach } from './selection'

// each with its owner: the site's list ticks projects of several owners
type Project = { id: string; name: string; status: ProjectStatus; ownerId: string }

// The ticked projects' bulk buttons, as core's project tools: the row
// actions (change owner, delete; restore and purge when deleted) run on each
// project in turn, and core's download of several projects as one zip
function ProjectsBulkActions({
  projects,
  deleted,
  onDone,
}: {
  projects: Project[]
  // the deleted projects' list offers restore and purge instead
  deleted: boolean
  onDone: () => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState<string | null>(null)
  // whether the open modal ran its action: a cancel keeps the ticks
  const ran = useRef(false)

  if (projects.length === 0) return null

  // the row's action of a project, by key
  const actionOf = (project: Project, key: string) =>
    [
      changeOwnerAction(t, project.id, project.ownerId),
      ...projectActions(t, project),
    ].find(
      action => action.key === key
    )!

  const groups = deleted
    ? [['project-restore'], ['project-purge']]
    : [['change-owner'], ['project-delete']]
  const template = (key: string) => actionOf(projects[0], key)
  const chosen = open ? template(open) : null

  const button = (key: string) => {
    const action = template(key)
    return (
      <OLTooltip
        key={key}
        id={`admin-projects-bulk-${key}`}
        description={action.label}
        overlayProps={{ placement: 'bottom', trigger: ['hover', 'focus'] }}
      >
        <OLIconButton
          variant="secondary"
          icon={action.icon}
          accessibilityLabel={action.label}
          onClick={() => setOpen(key)}
        />
      </OLTooltip>
    )
  }

  return (
    <OLButtonToolbar aria-label={t('actions')} className="admin-panel-bulk-actions">
      {!deleted && (
        <OLButtonGroup>
          <OLTooltip
            id="admin-projects-bulk-download"
            description={t('download')}
            overlayProps={{ placement: 'bottom', trigger: ['hover', 'focus'] }}
          >
            {/* a button that goes to the zip, as core's: a link's icon gets
                core's link margins and the button turns oval */}
            <OLIconButton
              variant="secondary"
              icon="download"
              accessibilityLabel={t('download')}
              onClick={() =>
                window.location.assign(
                  `/project/download/zip?project_ids=${projects.map(p => p.id).join(',')}`
                )
              }
            />
          </OLTooltip>
        </OLButtonGroup>
      )}
      {groups.map(keys => (
        <OLButtonGroup key={keys.join('-')}>{keys.map(button)}</OLButtonGroup>
      ))}
      {chosen && open && (
        <ConfirmModal
          subjects={projects.map(project => ({ title: project.name }))}
          action={{
            ...chosen,
            // a project's own owner is left out of the picker
            ownerExcludeIds: _.uniq(projects.map(project => project.ownerId)),
            run: options => {
              ran.current = true
              return runEach(
                projects,
                project => project.name,
                project => actionOf(project, open).run(options)
              )
            },
          }}
          // what was done stays done when some rows failed: the list reloads
          onHide={() => {
            setOpen(null)
            if (ran.current) onDone()
            ran.current = false
          }}
          onDone={() => {}}
        />
      )}
    </OLButtonToolbar>
  )
}

export default ProjectsBulkActions
