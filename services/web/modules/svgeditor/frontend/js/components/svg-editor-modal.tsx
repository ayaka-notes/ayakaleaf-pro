import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useProjectContext } from '@/shared/context/project-context'
import { useFileTreeData } from '@/shared/context/file-tree-data-context'
import { useEditorManagerContext } from '@/features/ide-react/context/editor-manager-context'
import { useLayoutContext } from '@/shared/context/layout-context'
import OLButton from '@/shared/components/ol/ol-button'
import LoadingSpinner from '@/shared/components/loading-spinner'
import {
  OLModal,
  OLModalBody,
  OLModalHeader,
  OLModalTitle,
} from '@/shared/components/ol/ol-modal'
import getMeta from '@/utils/meta'
import { BinaryFile } from '@/features/file-view/types/binary-file'
import {
  findParentFolderId,
  isDirty,
  looksLikeEditorLoaded,
} from '../util/svg-editor-utils'
import { saveEditedSvg } from '../util/svg-editor-save'
import './svg-editor.css'

/**
 * Full-space SVG editor modal (edit-in-place for `.svg` file views).
 *
 * Runs the vendored SVG-Edit 7.4.2 app (public/static/svgeditor/) in a
 * same-origin iframe and drives it through the embed bridge
 * (`window.__olSvgEmbed`): load(original), getSvg(), onChanged().
 *
 * Overleaf-native chrome: OLModal stretched to the whole available space
 * with a header that owns Save + Close (the app inside the iframe owns its
 * own toolbars). The Overleaf project file is the source of truth: Save
 * re-uploads the serialised canvas under the ORIGINAL file name, and the
 * preview refreshes to the new hash.
 *
 * Unsaved-changes guard: if the canvas differs from the loaded baseline,
 * closing (X / Escape / backdrop) shows a Keep editing / Discard card.
 * Mount backstop: if the bridge is not ready within 30 s (and no editor
 * DOM is visible), the error panel offers Retry.
 */

const EMBED_PATH = '/static/svgeditor/embed.html'
const STARTUP_TIMEOUT_MS = 30_000
const POLL_INTERVAL_MS = 150

type SvgBridge = {
  ready: boolean
  load: (svg: string) => Promise<void>
  getSvg: () => string
  onChanged: (cb: (svg: string) => void) => (() => void)
}

function fetchBridge(win: Window | null | undefined): SvgBridge | null {
  try {
    const b = (win as any)?.__olSvgEmbed
    if (b && typeof b.load === 'function' && typeof b.getSvg === 'function') {
      return b
    }
  } catch (e) {
    // cross-origin or not ready yet
  }
  return null
}

export default function SvgEditorModal({
  file,
  onClose,
}: {
  file: BinaryFile
  onClose: () => void
}) {
  const { projectId } = useProjectContext()
  const { fileTreeData } = useFileTreeData()
  const { openFileWithId } = useEditorManagerContext()
  const { setView } = useLayoutContext()
  const { t } = useTranslation()

  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(
    'loading'
  )
  const [error, setError] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)
  const [attempt, setAttempt] = useState(0)

  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const bridgeRef = useRef<SvgBridge | null>(null)
  const treeRef = useRef(fileTreeData)
  const unsubRef = useRef<null | (() => void)>(null)
  const baselineRef = useRef('')
  const startedLoadRef = useRef(false)
  const mountedRef = useRef(false)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])
  useEffect(() => {
    treeRef.current = fileTreeData
  }, [fileTreeData])

  /*
   * Mount sequence:
   *   1. the iframe loads the vendored embed page (SVG-Edit boots itself);
   *   2. in parallel we fetch the original SVG text from the blob route;
   *   3. we poll until the embed bridge is ready;
   *   4. we load the original into the canvas and capture the baseline
   *      serialisation (for dirty detection);
   *   5. any step failing within the backstop window shows the error
   *      panel with Retry.
   */
  useEffect(() => {
    let cancelled = false
    let poll: ReturnType<typeof setInterval> | null = null
    let backstop: ReturnType<typeof setTimeout> | null = null
    const fail = (message: string) => {
      if (cancelled) return
      setError(message)
      setStatus('error')
    }

    const textPromise = window
      .fetch(`/project/${projectId}/blob/${file.hash}`)
      .then(r => {
        if (!r.ok) throw new Error(`fetch_status_${r.status}`)
        return r.text()
      })
      .catch(() => null)

    const tryFinish = async (): Promise<boolean> => {
      const iframe = iframeRef.current
      const bridge = fetchBridge(iframe?.contentWindow)
      if (!bridge || !bridge.ready) return false
      if (startedLoadRef.current) return true
      startedLoadRef.current = true
      try {
        const text = await textPromise
        if (text == null) {
          throw new Error('initial_fetch_failed')
        }
        await bridge.load(text)
        baselineRef.current = bridge.getSvg() || text
        const unsub =
          typeof bridge.onChanged === 'function'
            ? bridge.onChanged((svg: string) => {
                if (
                  mountedRef.current &&
                  isDirty(svg, baselineRef.current)
                ) {
                  setDirty(true)
                }
              })
            : null
        bridgeRef.current = bridge
        unsubRef.current = typeof unsub === 'function' ? unsub : null
        if (!cancelled) {
          setStatus('ready')
          setError(null)
        }
        if (backstop) clearTimeout(backstop)
        return true
      } catch (err: any) {
        fail(
          err?.message === 'initial_fetch_failed'
            ? t('svg_edit_load_failed')
            : t('svg_edit_failed')
        )
        return false
      }
    }

    poll = setInterval(async () => {
      const done = await tryFinish()
      if (done && poll) clearInterval(poll)
    }, POLL_INTERVAL_MS)
    backstop = setTimeout(() => {
      clearInterval(poll)
      // The bridge `ready` flag is authoritative; the DOM check only
      // distinguishes "app never booted" from "app booted but its bridge
      // hung" — both fail, but the user gets an accurate hint.
      const doc = iframeRef.current?.contentDocument
      const editorRendered = looksLikeEditorLoaded(
        doc as unknown as
          | { querySelector(sel: string): Element | null }
          | null
      )
      fail(
        editorRendered
          ? t('svg_edit_bridge_failed')
          : t('svg_edit_startup_failed')
      )
    }, STARTUP_TIMEOUT_MS)

    return () => {
      cancelled = true
      clearInterval(poll)
      if (backstop) clearTimeout(backstop)
    }
    // A retry re-runs the whole sequence for the new iframe attempt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, file.hash, attempt])

  // Cleanup the bridge subscription on unmount (best effort: the iframe
  // page is discarded with the modal anyway).
  useEffect(() => {
    return () => {
      try {
        unsubRef.current?.()
      } catch (e) {
        // ignore
      }
    }
  }, [])

  const requestClose = useCallback(() => {
    if (saving) return
    if (dirty) {
      setConfirmClose(true)
      return
    }
    onClose()
  }, [saving, dirty, onClose])

  const handleSave = useCallback(async () => {
    const bridge = bridgeRef.current
    if (!bridge || saving) return
    setSaving(true)
    setError(null)
    try {
      const tree = treeRef.current
      const folderId =
        (tree && findParentFolderId(tree, file._id)) || tree?._id || ''
      const result = await saveEditedSvg({
        projectId,
        file: { name: file.name },
        folderId,
        csrfToken: (getMeta('ol-csrfToken') as string) || '',
        // `window.fetch` must be called with `window` as its receiver.
        fetchImpl: (url: RequestInfo | URL, init?: RequestInit) =>
          window.fetch(url, init),
        getSvg: () => {
          try {
            return bridge.getSvg()
          } catch (e) {
            return ''
          }
        },
        t,
      })
      if (!result.ok) {
        throw new Error(result.error)
      }
      const uploadedId = result.uploadedId
      const uploadedHash = result.uploadedHash

      // CRITICAL ORDER (same lesson as the raster editor): close FIRST,
      // then refresh — detached. The replace commits a real-time delete of
      // the old file which unmounts this pane (and this component) while
      // the upload response is still in flight; any refresh code bound to
      // our component state dies with it. The refresh below therefore uses
      // only app-level context closures (openFileWithId/setView) plus the
      // DOM — all of which survive our unmount — and verifies the preview
      // really shows the new bytes, re-asserting a bounded number of
      // times.
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
          const row = document.querySelector(
            `.file-tree li[role="treeitem"][aria-label="${esc(file.name)}"]`
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
        // The SVG preview renders as <img> in the file view (FileViewImage),
        // same as raster previews.
        const img = document.querySelector(
          '.file-view img'
        ) as HTMLImageElement | null
        if (!img || !img.src) return false
        if (uploadedHash) return img.src.includes(uploadedHash)
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
        setDirty(false)
        setError(null)
      }
      onClose()
      await refreshDetached()
    } catch (err: unknown) {
      const message =
        (err as Error)?.message || t('svg_edit_failed')
      // eslint-disable-next-line no-console
      console.error('svgeditor: save failed', message, err)
      if (mountedRef.current) setError(message)
    } finally {
      if (mountedRef.current) setSaving(false)
    }
  }, [
    file,
    projectId,
    saving,
    onClose,
    openFileWithId,
    setView,
    t,
  ])

  const originalUrl = `/project/${projectId}/blob/${file.hash}`

  return (
    <OLModal
      show
      className="svg-editor-modal"
      onHide={requestClose}
      aria-label={t('edit_svg')}
    >
      <OLModalHeader>
        <OLModalTitle>{t('edit_svg_title', { name: file.name })}</OLModalTitle>
        <OLButton
          className="svg-editor-save"
          variant="primary"
          disabled={!dirty || saving || status !== 'ready'}
          onClick={() => void handleSave()}
          aria-label={t('save_svg')}
        >
          {saving ? <LoadingSpinner size="sm" /> : t('save_svg')}
        </OLButton>
      </OLModalHeader>
      <OLModalBody className="svg-editor-body">
        <iframe
          key={attempt}
          ref={iframeRef}
          className="svg-editor-frame"
          title={t('edit_svg')}
          src={`${EMBED_PATH}?name=${encodeURIComponent(file.name)}`}
        />
        {status === 'loading' && (
          <div className="svg-editor-loading">
            <div className="svg-editor-loading-inner">
              <LoadingSpinner size="lg" />
              <span>{t('svg_edit_loading')}</span>
            </div>
          </div>
        )}
        {status === 'error' && (
          <div className="svg-editor-error" role="alert">
            <div className="svg-editor-error-card">
              <p className="svg-editor-error-title">
                {t('svg_edit_startup_failed_title')}
              </p>
              <p className="svg-editor-error-message">
                {error || t('svg_edit_startup_failed')}
              </p>
              <div className="svg-editor-error-actions">
                <OLButton
                  variant="secondary"
                  href={originalUrl}
                  target="_blank"
                >
                  {t('open_original')}
                </OLButton>
                <OLButton
                  variant="primary"
                  onClick={() => {
                    setAttempt(a => a + 1)
                    setStatus('loading')
                    setError(null)
                    startedLoadRef.current = false
                  }}
                >
                  {t('retry')}
                </OLButton>
              </div>
            </div>
          </div>
        )}
        {confirmClose && (
          <div className="svg-editor-guard" role="dialog" aria-modal="true">
            <div className="svg-editor-guard-card">
              <p className="svg-editor-guard-question">
                {t('unsaved_svg_changes')}
              </p>
              <div className="svg-editor-guard-actions">
                <OLButton variant="secondary" onClick={() => setConfirmClose(false)}>
                  {t('keep_editing')}
                </OLButton>
                <OLButton
                  variant="danger"
                  onClick={() => {
                    setConfirmClose(false)
                    onClose()
                  }}
                >
                  {t('discard_and_close')}
                </OLButton>
              </div>
            </div>
          </div>
        )}
      </OLModalBody>
    </OLModal>
  )
}
