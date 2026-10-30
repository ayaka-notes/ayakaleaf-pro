import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  OLModal,
  OLModalBody,
  OLModalFooter,
  OLModalHeader,
  OLModalTitle,
} from '@/shared/components/ol/ol-modal'
import OLButton from '@/shared/components/ol/ol-button'
import OLFormSelect from '@/shared/components/ol/ol-form-select'
import OLFormSwitch from '@/shared/components/ol/ol-form-switch'
import { useDetachCompileContext } from '@/shared/context/detach-compile-context'
import { useIdeReactContext } from '@/features/ide-react/context/ide-react-context'
import { usePermissionsContext } from '@/features/ide-react/context/permissions-context'
import { useProjectContext } from '@/shared/context/project-context'
import { useFileTreeData } from '@/shared/context/file-tree-data-context'
import { getJSON, postJSON } from '@/infrastructure/fetch-json'
import { isValidTeXFile } from '@/main/is-valid-tex-file'
import getMeta from '@/utils/meta'
import { debugConsole } from '@/utils/debugging'
import usePersistedState from '@/shared/hooks/use-persisted-state'
import { COMPILE_SETUP_PROMPT_ENABLED_KEY } from '../compile-setup-prompt'
import type {
  ImageName,
  MainDocument,
  ProjectCompiler,
} from '../../../../../types/project-settings'

import '../../stylesheets/compile-setup.scss'

const COMPILERS: ProjectCompiler[] = [
  'pdflatex',
  'latex',
  'xelatex',
  'lualatex',
]

const COMPILER_LABELS: Record<ProjectCompiler, string> = {
  pdflatex: 'pdfLaTeX',
  latex: 'LaTeX',
  xelatex: 'XeLaTeX',
  lualatex: 'LuaLaTeX',
}

const FALLBACK_COMPILER: ProjectCompiler = 'pdflatex'

type CompileMode = 'normal' | 'fast_draft'

function getDefaultCompiler(): ProjectCompiler {
  const configured = getMeta('ol-defaultLatexCompiler')
  if (configured) {
    const normalized = configured.toLowerCase()
    const match = COMPILERS.find(compiler => compiler === normalized)
    if (match) {
      return match
    }
  }
  return FALLBACK_COMPILER
}

// Projects store the full image name (e.g. "ghcr.io/org/texlive-full:2026.1")
// while the dropdown options use the bare name ("texlive-full:2026.1").
function getBareImageName(imageName?: string) {
  return imageName ? imageName.split('/').pop() || '' : ''
}

/**
 * Prompts for the compile settings the first time a project is opened.
 *
 * The "already asked" state is stored per project on the server, so any
 * collaborator who confirms the settings once silences the prompt for
 * everybody. Closing the dialog does not mark the project as configured.
 * Users can turn the prompt off from the Compiler settings tab.
 */
export default function CompileSetupModal() {
  const { t } = useTranslation()
  const { projectId, project, updateProject } = useProjectContext()
  const { projectJoined } = useIdeReactContext()
  const { write } = usePermissionsContext()
  const { docs } = useFileTreeData()
  const {
    draft,
    autoCompile,
    stopOnFirstError,
    setDraft,
    setAutoCompile,
    setStopOnFirstError,
  } = useDetachCompileContext()

  const [show, setShow] = useState(false)
  const [saving, setSaving] = useState(false)
  const [compiler, setCompiler] = useState<ProjectCompiler>(FALLBACK_COMPILER)
  const [imageName, setImageName] = useState('')
  const [rootDocId, setRootDocId] = useState('')
  const [compileMode, setCompileMode] = useState<CompileMode>('normal')
  const [stopOnFirstErrorValue, setStopOnFirstErrorValue] = useState(false)
  const [autoCompileValue, setAutoCompileValue] = useState(false)
  const checkedRef = useRef(false)

  const [promptEnabled] = usePersistedState(
    COMPILE_SETUP_PROMPT_ENABLED_KEY,
    true,
    { listen: true }
  )

  const imageNames = useMemo(
    () => (getMeta('ol-imageNames') || []) as ImageName[],
    []
  )

  const imageOptions = useMemo(
    () =>
      imageNames
        .filter(image => image.allowed || image.imageName === imageName)
        .map(image => ({ value: image.imageName, label: image.imageDesc })),
    [imageNames, imageName]
  )

  const texDocs = useMemo(() => (docs || []) as MainDocument[], [docs])

  const rootDocOptions = useMemo(
    () =>
      texDocs
        .filter(doc => isValidTeXFile(doc.doc.name) || doc.doc.id === rootDocId)
        .map(doc => ({ value: doc.doc.id as string, label: doc.path })),
    [texDocs, rootDocId]
  )

  const hasTexDocs = useMemo(
    () => texDocs.some(doc => isValidTeXFile(doc.doc.name)),
    [texDocs]
  )

  useEffect(() => {
    if (checkedRef.current || !promptEnabled) {
      return
    }
    if (
      !projectJoined ||
      !write ||
      !project ||
      !docs ||
      !getMeta('ol-user_id')
    ) {
      return
    }
    if ((project as { readOnly?: boolean }).readOnly) {
      return
    }

    let cancelled = false

    const load = async () => {
      try {
        const status = await getJSON<{ completed: boolean }>(
          `/project/${projectId}/compile-setup`
        )
        if (cancelled) {
          return
        }
        checkedRef.current = true
        if (status.completed) {
          return
        }

        const currentImage = getBareImageName(project.imageName)
        const matchingImage = imageNames.find(
          image => image.imageName === currentImage
        )
        const fallbackImage = imageNames.find(image => image.allowed)
        setCompiler(
          (project.compiler as ProjectCompiler) || getDefaultCompiler()
        )
        setImageName(matchingImage?.imageName || fallbackImage?.imageName || '')
        setRootDocId(project.rootDocId || '')
        setCompileMode(draft ? 'fast_draft' : 'normal')
        setStopOnFirstErrorValue(stopOnFirstError)
        setAutoCompileValue(autoCompile)
        setShow(true)
      } catch (err) {
        debugConsole.error(err)
      }
    }

    load()

    return () => {
      cancelled = true
    }
  }, [
    docs,
    imageNames,
    project,
    projectId,
    projectJoined,
    write,
    promptEnabled,
    draft,
    stopOnFirstError,
    autoCompile,
  ])

  const canSave =
    !saving &&
    Boolean(compiler) &&
    (imageOptions.length === 0 || Boolean(imageName)) &&
    (!hasTexDocs || Boolean(rootDocId))

  const handleSave = useCallback(async () => {
    if (!canSave) {
      return
    }
    setSaving(true)
    try {
      const settings: Record<string, string> = { compiler }
      if (imageName) {
        settings.imageName = imageName
      }
      if (rootDocId) {
        settings.rootDocId = rootDocId
      }

      await postJSON(`/project/${projectId}/settings`, { body: settings })
      await postJSON(`/project/${projectId}/compile-setup`, { body: {} })

      if (compileMode !== (draft ? 'fast_draft' : 'normal')) {
        setDraft(compileMode === 'fast_draft')
      }
      if (stopOnFirstErrorValue !== stopOnFirstError) {
        setStopOnFirstError(stopOnFirstErrorValue)
      }
      if (autoCompileValue !== autoCompile) {
        setAutoCompile(autoCompileValue)
      }

      updateProject({
        compiler,
        ...(imageName ? { imageName } : {}),
        ...(rootDocId ? { rootDocId } : {}),
      })
      setShow(false)
    } catch (err) {
      debugConsole.error(err)
    } finally {
      setSaving(false)
    }
  }, [
    autoCompile,
    autoCompileValue,
    canSave,
    compileMode,
    compiler,
    draft,
    imageName,
    projectId,
    rootDocId,
    setAutoCompile,
    setDraft,
    setStopOnFirstError,
    stopOnFirstError,
    stopOnFirstErrorValue,
    updateProject,
  ])

  return (
    <OLModal
      show={show}
      onHide={() => setShow(false)}
      size="lg"
      className="compile-setup-modal"
    >
      <OLModalHeader closeButton>
        <OLModalTitle>
          {t('compiler')} {t('settings')}
        </OLModalTitle>
      </OLModalHeader>
      <OLModalBody>
        <div className="compile-setup-form">
          <div className="compile-setup-row">
            <label
              className="compile-setup-label"
              htmlFor="compile-setup-root-doc"
            >
              {hasTexDocs && (
                <span className="compile-setup-required" aria-hidden="true">
                  *
                </span>
              )}
              {t('main_document')}
            </label>
            <OLFormSelect
              id="compile-setup-root-doc"
              value={rootDocId}
              disabled={!hasTexDocs}
              onChange={event => setRootDocId(event.target.value)}
            >
              {!rootDocId && (
                <option value="" disabled={hasTexDocs}>
                  None
                </option>
              )}
              {rootDocOptions.map(option => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </OLFormSelect>
          </div>

          <div className="compile-setup-row">
            <label
              className="compile-setup-label"
              htmlFor="compile-setup-compiler"
            >
              <span className="compile-setup-required" aria-hidden="true">
                *
              </span>
              {t('compiler')}
            </label>
            <OLFormSelect
              id="compile-setup-compiler"
              value={compiler}
              onChange={event =>
                setCompiler(event.target.value as ProjectCompiler)
              }
            >
              {COMPILERS.map(value => (
                <option key={value} value={value}>
                  {COMPILER_LABELS[value]}
                </option>
              ))}
            </OLFormSelect>
          </div>

          {imageOptions.length > 0 && (
            <div className="compile-setup-row">
              <label
                className="compile-setup-label"
                htmlFor="compile-setup-image-name"
              >
                <span className="compile-setup-required" aria-hidden="true">
                  *
                </span>
                {t('tex_live_version')}
              </label>
              <OLFormSelect
                id="compile-setup-image-name"
                value={imageName}
                onChange={event => setImageName(event.target.value)}
              >
                {!imageName && <option value="">{'—'}</option>}
                {imageOptions.map(option => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </OLFormSelect>
            </div>
          )}

          <div className="compile-setup-row">
            <label
              className="compile-setup-label"
              htmlFor="compile-setup-compile-mode"
            >
              {t('compile_mode')}
            </label>
            <OLFormSelect
              id="compile-setup-compile-mode"
              value={compileMode}
              onChange={event =>
                setCompileMode(event.target.value as CompileMode)
              }
            >
              <option value="normal">{t('normal')}</option>
              <option value="fast_draft">{t('fast_draft')}</option>
            </OLFormSelect>
          </div>

          <div className="compile-setup-row">
            <span className="compile-setup-label">
              {t('stop_on_first_error')}
            </span>
            <div className="compile-setup-switch">
              <OLFormSwitch
                id="compile-setup-stop-on-first-error"
                label={t('stop_on_first_error')}
                checked={stopOnFirstErrorValue}
                onChange={event =>
                  setStopOnFirstErrorValue(event.target.checked)
                }
              />
            </div>
          </div>

          <div className="compile-setup-row">
            <span className="compile-setup-label">{t('autocompile')}</span>
            <div className="compile-setup-switch">
              <OLFormSwitch
                id="compile-setup-auto-compile"
                label={t('autocompile')}
                checked={autoCompileValue}
                onChange={event => setAutoCompileValue(event.target.checked)}
              />
            </div>
          </div>
        </div>
      </OLModalBody>
      <OLModalFooter>
        <OLButton
          variant="primary"
          onClick={handleSave}
          disabled={!canSave}
          isLoading={saving}
        >
          {t('save')}
        </OLButton>
      </OLModalFooter>
    </OLModal>
  )
}
