import {
  Component,
 lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ErrorInfo,
  type ReactNode,
} from 'react'
import { useTranslation } from 'react-i18next'
import { useProjectContext } from '@/shared/context/project-context'
import { useFileTreeData } from '@/shared/context/file-tree-data-context'
import { useEditorManagerContext } from '@/features/ide-react/context/editor-manager-context'
import { useLayoutContext } from '@/shared/context/layout-context'
import OLButton from '@/shared/components/ol/ol-button'
import MaterialIcon from '@/shared/components/material-icon'
import LoadingSpinner from '@/shared/components/loading-spinner'
import OLNotification from '@/shared/components/notification'
import {
  OLModal,
  OLModalBody,
} from '@/shared/components/ol/ol-modal'
import getMeta from '@/utils/meta'
import {
  findParentFolderId,
  isEditableImage,
  looksLikeEditorMounted,
  outputFormatForName,
  type TreeNode,
} from '../util/toast-image-utils'
import { saveEditedImage } from '../util/toast-image-save'
import './toast-image-editor.css'

// Code-split the editor (FIE pulls Konva + styled-components — kept out of
// the main IDE bundle).
const FilerobotImageEditor = lazy(
  () =>
    import('react-filerobot-image-editor').then(m => ({
      default: m.default,
    }))
)

// FIE 4.9.1 stable tab ids (TABS_IDS in react-filerobot-image-editor/utils/constants.
// js). Inlined here so the lazy chunk stays the only FIE import (a static
// `import { TABS }` would pull the whole library into the main bundle).
const TAB_IDS: Array<
  'Finetune' | 'Filters' | 'Adjust' | 'Annotate' | 'Watermark' | 'Resize'
> = ['Finetune', 'Filters', 'Adjust', 'Annotate', 'Watermark', 'Resize']
const TAB_ADJUST: 'Adjust' = 'Adjust'
const TOOL_CROP: 'Crop' = 'Crop'

type EditorFile = {
  _id: string
  name: string
  hash: string
}

export default function ToastImageFileViewButton({
  file,
}: {
  file: EditorFile
}) {
  if (!isEditableImage(file.name)) {
    return null
  }
  return <EditImageButton file={file} />
}

function EditImageButton({ file }: { file: EditorFile }) {
  const { t } = useTranslation()
  const [showEditor, setShowEditor] = useState(false)

  return (
    <>
      <div style={{ display: 'inline-block', marginLeft: '8px' }}>
        <OLButton variant="secondary" onClick={() => setShowEditor(true)}>
          <MaterialIcon type="edit" className="align-middle" />{' '}
          <span>{t('edit_image')}</span>
        </OLButton>
      </div>
      {showEditor && (
        <ImageEditorModal file={file} onClose={() => setShowEditor(false)} />
      )}
    </>
  )
}

/**
 * Full-screen Filerobot Image Editor (FIE, react-filerobot-image-editor
 * 4.9.1 — Konva-based, actively maintained) for a project image file.
 *
 * Architecture (kept Overleaf-native):
 * - OL chrome: OLModal (title + close), OLNotification errors, OLButton
 *   footer (Close + unsaved-changes guard). No Mantine, no third-party
 *   app shell.
 * - FIE owns the editing surface (tabs, tools, its save dialog). FIE's
 *   topbar Save button drives saving: `onSave(imageData, designState)`
 *   receives the exported image as a base64 data URL (`imageBase64`,
 *   format/quality chosen in FIE's save dialog) and may return a Promise
 *   — FIE keeps its "saving" state until it settles. We upload through
 *   the standard project upload endpoint (replacing the file under the
 *   same name) and only then close the modal.
 * - Dirty tracking: FIE fires `onModify` on every design change — far
 *   simpler and more reliable than editor-internals event spelunking.
 * - Offline guarantee: `useBackendTranslations: false` disables FIE's
 *   runtime translation XHR to scaleflex's i18n backend (it is DEFAULT
 *   ON upstream and would otherwise send a dynamic external request on
 *   mount); `useCloudimage: false` keeps the Cloudimage proxy off. All
 *   FIE code (Konva, styled-components, icons) is bundled at image build
 *   time via the lazy chunk.
 */
function ImageEditorModal({
  file,
  onClose,
}: {
  file: EditorFile
  onClose: () => void
}) {
  const { t } = useTranslation()
  const { projectId } = useProjectContext()
  const { fileTreeData } = useFileTreeData()
  const { openFileWithId } = useEditorManagerContext()
  const { setView } = useLayoutContext()

  const containerRef = useRef<HTMLDivElement | null>(null)
  const mountedRef = useRef(true)
  const dirtyRef = useRef(false)
  const treeRef = useRef<TreeNode | null>(null)

  const [sized, setSized] = useState(false)
  const [failed, setFailed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [guardOpen, setGuardOpen] = useState(false)
  const [retryTick, setRetryTick] = useState(0)

  // FIE mounts into a container; give it a non-zero size first (same
  // deterministic-init discipline as before): render the editor only once
  // the modal body has laid out.
  useEffect(() => {
    let cancelled = false
    const check = () => {
      const el = containerRef.current
      if (!el || cancelled) return false
      const rect = el.getBoundingClientRect()
      return rect.width > 0 && rect.height > 0
    }
    if (check()) {
      setSized(true)
      return
    }
    let n = 0
    const iv = window.setInterval(() => {
      n += 1
      if (check() || n > 200) {
        window.clearInterval(iv)
        if (!cancelled) setSized(check() || n <= 200)
      }
    }, 15)
    return () => {
      cancelled = true
      window.clearInterval(iv)
    }
  }, [retryTick])

  useEffect(() => {
    treeRef.current = (fileTreeData as unknown as TreeNode) ?? null
  }, [fileTreeData])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  // Hard backstop: if the lazy editor chunk or its mount ever hangs (no
  // Suspense resolution, no error), the user must not sit on the spinner
  // forever — surface the failure state with an escape hatch.
  // MOUNT-AWARE (4.9.1 follow-up fix): the earlier version fired
  // unconditionally 30s after open and killed perfectly healthy sessions
  // ("after some time the editor dies"). The backstop is now cancelled the
  // moment the FIE app actually renders inside the host (stable FIE_*
  // classes / canvas), so a working editor stays open indefinitely.
  const MOUNT_BACKSTOP_MS = 30_000
  useEffect(() => {
    const isMounted = () => looksLikeEditorMounted(containerRef.current)
    const backstop = window.setTimeout(() => {
      window.clearInterval(watch)
      if (!mountedRef.current || isMounted()) return
      setError(
        t(
          'image_edit_backstop',
          'The image editor could not be initialized. You can still open the original image.'
        )
      )
      setFailed(true)
    }, MOUNT_BACKSTOP_MS)
    const watch = window.setInterval(() => {
      if (isMounted()) window.clearTimeout(backstop)
    }, 250)
    return () => {
      window.clearTimeout(backstop)
      window.clearInterval(watch)
    }
  }, [retryTick, t])

  // Close funnel with the unsaved-changes guard (for the flag-less paths:
  // Escape / backdrop click route through OLModal's onHide, which FIE does
  // not intercept). While a save is in flight we ignore close requests:
  // the upload is still mid-commit and the pane state is being swapped
  // under us.
  const closeThroughGuard = useCallback(
    (haveUnsaved: boolean) => {
      if (saving) return
      if (haveUnsaved) {
        setGuardOpen(true)
        return
      }
      onClose()
    },
    [saving, onClose]
  )

  const handleFieClose = useCallback(
    (_reason: string, _haveNotSavedChanges: boolean) => {
      // FIE 4.9.1 natively guards the close button: with unsaved changes
      // it shows its own "Discard changes?" confirmation and only calls us
      // after the user confirms (immediately when there is nothing to
      // lose). Closing directly is correct — guarding here would ask the
      // user twice. (Escape / backdrop still use our own guard card,
      // because that path bypasses FIE entirely.)
      if (saving) return
      onClose()
    },
    [saving, onClose]
  )

  const handleModalHide = useCallback(() => {
    closeThroughGuard(dirtyRef.current)
  }, [closeThroughGuard])

  // Robust Escape handling. React-bootstrap only catches Escape when the
  // DOM focus is INSIDE the modal element, so some real flows (e.g. right
  // after FIE's portaled dialogs, or after focus returns to a portal)
  // silently swallow the key. We therefore add a document-level capture
  // listener that owns the dirty path deterministically:
  //  - FIE's own dialog open  → leave it to FIE (it handles its Escape)
  //  - our guard card open    → Escape = "Keep editing" (close the card)
  //  - dirty, nothing open    → show our guard card, swallow the key
  //  - not dirty, nothing open→ fall through: OLModal's own handler does
  //    a clean close (onHide → closeThroughGuard(false)).
  const guardOpenRef = useRef(false)
  useEffect(() => {
    guardOpenRef.current = guardOpen
  }, [guardOpen])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (saving) {
        e.preventDefault()
        return
      }
      if (document.querySelector('[class*="SfxModal-Container"]')) return
      if (guardOpenRef.current) {
        e.preventDefault()
        e.stopPropagation()
        setGuardOpen(false)
        return
      }
      if (dirtyRef.current) {
        e.preventDefault()
        e.stopPropagation()
        setGuardOpen(true)
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [saving])

  // FIE save flow. FIE calls onSave(imageData, designState) after the user
  // confirms ITS save dialog (name/format/quality/resize), and waits on the
  // returned promise for its own "saving" state. imageData.imageBase64 is
  // the final export as a data URL (Konva toDataURL with the chosen
  // mime/quality). We upload it over the standard project upload endpoint
  // under the ORIGINAL file name (replacing the file), refresh the file
  // view via the file-tree-open context, and close. On failure we stay
  // open with the error visible so the user can retry from FIE's Save.
  const handleFieSave = useCallback(
    async (imageData: {
      imageBase64?: string
      imageCanvas?: HTMLCanvasElement
      name?: string
      extension?: string
    }) => {
      const set = (fn: (prev: string | null) => string | null) => {
        if (mountedRef.current) setError(fn)
      }
      const setSavingState = (v: boolean) => {
        if (mountedRef.current) setSaving(v)
      }
      setSavingState(true)
      set(() => null)
      try {
        const dataUrl =
          imageData.imageBase64 ||
          (imageData.imageCanvas?.toDataURL() ?? '')
        if (!dataUrl) {
          throw new Error(t('image_edit_failed'))
        }

        const tree = treeRef.current
        const folderId =
          (tree && findParentFolderId(tree, file._id)) || tree?._id || ''
        const result = await saveEditedImage({
          projectId,
          file: { name: file.name },
          folderId,
          csrfToken: (getMeta('ol-csrfToken') as string) || '',
          // `window.fetch` must be called with `window` as its receiver — a
          // bare detached reference throws "Illegal invocation" in the
          // browser. Bind it explicitly.
          fetchImpl: (url: RequestInfo | URL, init?: RequestInit) =>
            window.fetch(url, init),
          toDataURL: () => dataUrl,
          t,
        })
        if (!result.ok) {
          throw new Error(result.error)
        }
        const uploadedId = result.uploadedId
        const uploadedHash = result.uploadedHash

        // CRITICAL ORDER: close the modal FIRST, then refresh — detached.
        // When the replace is committed, the real-time delete event
        // unmounts the file-view pane (and therefore THIS modal + editor
        // tree) while the upload response is still in flight; any refresh
        // code bound to our component state dies with it (observed:
        // mounted flipped to false mid-save). The refresh below therefore
        // uses only app-level context closures (openFileWithId/setView)
        // plus the DOM — all of which survive our unmount — and verifies
        // that the preview really shows the new bytes, re-asserting a
        // bounded number of times (a late real-time event can close the
        // pane again after we re-open it).
        const sleep = (ms: number) =>
          new Promise<void>(r => {
            setTimeout(r, ms)
          })
        const rowClick = () => {
          try {
            const esc =
              typeof CSS !== 'undefined' && CSS.escape
                ? CSS.escape
                : (s: string) => s
            // File-tree rows are <li role="treeitem" aria-label="<name>">
            // with the React onClick (selection + setView('file')) bound
            // on the element — emulating that click is the exact human path.
            const row = document.querySelector(
              `.file-tree li[role="treeitem"][aria-label="${esc(
                file.name
              )}"]`
            ) as HTMLElement | null
            if (!row) return
            const opts = {
              bubbles: true,
              cancelable: true,
              composed: true,
              view: window,
            }
            row.dispatchEvent(new MouseEvent('mousedown', opts))
            row.dispatchEvent(new MouseEvent('mouseup', opts))
            row.click()
          } catch (err) {
            // Non-fatal — the user can always re-select the file.
          }
        }
        const paneShowsNewFile = (): boolean => {
          const img = document.querySelector(
            '.file-view img'
          ) as HTMLImageElement | null
          if (!img || !img.src) return false
          if (uploadedHash) return img.src.includes(uploadedHash)
          // No hash to match against: any preview image is acceptable — but
          // make sure it is not the deleted old file.
          return !img.src.includes(file.hash)
        }
        const refreshDetached = async () => {
          if (!uploadedId) return
          for (let i = 0; i < 10; i++) {
            try {
              openFileWithId(uploadedId) // no-op until the tree has it
              setView('file')
            } catch (err) {
              // context paths unavailable — the DOM path below still works
            }
            rowClick()
            await sleep(1_000)
            if (paneShowsNewFile()) return
          }
        }

        if (mountedRef.current) {
          set(() => null)
          dirtyRef.current = false
        }
        onClose()
        await refreshDetached()
      } catch (err: unknown) {
        const message =
          (err as Error)?.message || t('image_edit_failed')
        // eslint-disable-next-line no-console
        console.error('toast-image: save failed', message, err)
        set(() => message)
      } finally {
        setSavingState(false)
      }
    },
    [file, projectId, onClose, openFileWithId, setView, t]
  )

  const handleFieModify = useCallback(() => {
    // FIE fires onModify on every design change → mark the session dirty
    // for our unsaved-changes guard.
    dirtyRef.current = true
  }, [])

  const originalUrl = `/project/${projectId}/blob/${file.hash}`

  return (
    <OLModal
      // FIE's own topbar owns title/close/save — the OL header was
      // removed (user request) so the editor uses the whole available
      // space. CSS stretch lives in toast-image-editor.css.
      size="lg"
      show
      className="toast-image-editor-modal"
      onHide={handleModalHide}
    >
      <OLModalBody>
        {failed ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 12,
              padding: '48px 24px',
            }}
          >
            <p>{error || t('image_edit_failed')}</p>
            <a
              href={originalUrl}
              target="_blank"
              rel="noreferrer"
              style={{ textDecoration: 'underline', fontSize: 14 }}
            >
              {t('image_edit_open_original', 'Open original image')}
            </a>
            <OLButton
              variant="primary"
              onClick={() => {
                setFailed(false)
                setError(null)
                setSized(false)
                dirtyRef.current = false
                setRetryTick(n => n + 1)
              }}
            >
              {t('retry', 'Retry')}
            </OLButton>
          </div>
        ) : (
          <>
            {error && <OLNotification type="error" content={error} />}
            <div
              ref={containerRef}
              className="toast-image-editor-host"
              style={{ position: 'relative', width: '100%', height: '100%' }}
            >
              {sized && (
                <ErrorBoundary
                  onReset={() => {
                    setError(
                      t(
                        'image_edit_backstop',
                        'The image editor could not be initialized. You can still open the original image.'
                      )
                    )
                    setFailed(true)
                  }}
                >
                  <Suspense
                    fallback={
                      <div className="toast-image-editor-loading">
                        <LoadingSpinner />
                        <div className="toast-image-editor-loading-inner">
                          <span>
                            {t('image_edit_loading', 'Loading the image editor…')}
                          </span>
                          <a
                            href={originalUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {t('image_edit_open_original', 'Open original image')}
                          </a>
                        </div>
                      </div>
                    }
                  >
                    <FilerobotImageEditor
                      source={originalUrl}
                      // Full tab experience (crop/rotate/flip under Adjust,
                      // brightness/contrast/hsv/warmth under Finetune,
                      // blur/threshold/posterize/pixelate/noise under
                      // Filters, text/pen/shapes/image under Annotate,
                      // watermark, and resize).
                      tabsIds={TAB_IDS}
                      defaultTabId={TAB_ADJUST}
                      defaultToolId={TOOL_CROP}
                      // Save plumbing: FIE's own save dialog (name/format/
                      // quality/resize) stays the save entry point; we drive
                      // the actual upload through our endpoint and close
                      // only after success (closeAfterSave:false).
                      closeAfterSave={false}
                      defaultSavedImageName={file.name.replace(
                        /\.(png|jpe?g|gif|webp)$/i,
                        ''
                      )}
                      defaultSavedImageType={outputFormatForName(
                        file.name
                      ) as 'png' | 'jpeg'}
                      defaultSavedImageQuality={0.88}
                      // Export at the design (native) size. FIE defaults to
                      // savingPixelRatio:4 — 4× the original dimensions —
                      // which would blow up memory on large images.
                      savingPixelRatio={1}
                      // FIE 4.9.1's published types declare this field required
                      // (runtime default is window.devicePixelRatio || 1).
                      previewPixelRatio={
                        typeof window !== 'undefined'
                          ? window.devicePixelRatio || 1
                          : 1
                      }
                      // OFFLINE REQUIREMENT (critical): FIE ships with
                      // useBackendTranslations TRUE — on mount it XHRs to
                      // i18n-fastly.ultrafast.io (and reports missing
                      // translation keys to neo.wordplex.io). Disable it;
                      // FIE's bundled English strings are used instead.
                      useBackendTranslations={false}
                      useCloudimage={false}
                      language="en"
                      // Dirty tracking for our unsaved-changes guard.
                      onModify={handleFieModify}
                      onSave={handleFieSave}
                      // FIE-originated close (its topbar X / back paths):
                      // FIE reports the unsaved-changes flag, we route
                      // through the guard below.
                      onClose={handleFieClose}
                    />
                  </Suspense>
                </ErrorBoundary>
              )}
              {!sized && !failed && (
                <div className="toast-image-editor-loading">
                  <LoadingSpinner />
                  <div className="toast-image-editor-loading-inner">
                    <span>
                      {t('image_edit_loading', 'Loading the image editor…')}
                    </span>
                    <a
                      href={originalUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {t('image_edit_open_original', 'Open original image')}
                    </a>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
        {guardOpen && (
          // Unsaved-changes guard. The OL footer was removed (user request:
          // editor uses the whole space), so the guard — previously in the
          // footer — floats as a center card over the editor. Triggered by
          // FIE's topbar close (X) or by Escape / backdrop click.
          <div
            className="toast-image-guard"
            role="alertdialog"
            aria-live="assertive"
            aria-label={t('unsaved_image_changes')}
          >
            <div className="toast-image-guard-card">
              <p className="toast-image-guard-question">
                {t('unsaved_image_changes')}
              </p>
              <div className="toast-image-guard-actions">
                <OLButton
                  variant="secondary"
                  autoFocus
                  onClick={() => setGuardOpen(false)}
                >
                  {t('keep_editing', 'Keep editing')}
                </OLButton>
                <OLButton
                  variant="danger"
                  onClick={() => {
                    setGuardOpen(false)
                    onClose()
                  }}
                >
                  {t('discard', 'Discard')}
                </OLButton>
              </div>
            </div>
          </div>
        )}
      </OLModalBody>
    </OLModal>
  )
}

class ErrorBoundary extends Component<
  { children: ReactNode; onReset: () => void },
  { failed: boolean }
> {
  constructor(props: { children: ReactNode; onReset: () => void }) {
    super(props)
    this.state = { failed: false }
  }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(_error: Error, _info: ErrorInfo) {
    this.props.onReset()
  }

  render() {
    if (this.state.failed) return null
    return this.props.children
  }
}
