/**
 * SVG editor save flow, extracted from the React component so it can be
 * unit-tested in Node (fetch is injected; Node 22 provides FormData/Blob).
 *
 * The embedded SVG-Edit bridge serialises the canvas with getSvg(); we
 * upload that text under the ORIGINAL file name (replacing the file) via
 * the standard Overleaf project upload endpoint.
 */

import { isSvgFile } from './svg-editor-utils'

export interface SaveInput {
  projectId: string
  file: { name: string }
  folderId: string
  /** CSRF token (from ol-csrfToken meta). */
  csrfToken?: string
  fetchImpl: typeof fetch
  /** Serialised canvas content (SVG text) from the embedded bridge. */
  getSvg: () => string
  /** i18n translate function. */
  t: (key: string, options?: Record<string, unknown>) => string
}

export type SaveResult =
  | { ok: true; uploadedId: string | null; uploadedHash: string | null }
  | { ok: false; error: string }

/**
 * Re-upload the edited SVG under the same file name (replacing the file).
 * Returns the uploaded entity id (when the server responds with JSON) so
 * the caller can refresh the file view.
 */
export async function saveEditedSvg(input: SaveInput): Promise<SaveResult> {
  try {
    if (!isSvgFile(input.file.name)) {
      throw new Error(input.t('svg_edit_failed'))
    }
    const svgText = (input.getSvg() || '').trim()
    if (!svgText) {
      throw new Error(input.t('svg_edit_failed'))
    }

    const blob = new Blob([svgText], { type: 'image/svg+xml' })
    const formData = new FormData()
    formData.append('qqfile', blob, input.file.name)
    formData.append('name', input.file.name)

    const uploadRes = await input.fetchImpl(
      `/project/${input.projectId}/upload?folder_id=${encodeURIComponent(
        input.folderId || ''
      )}`,
      {
        method: 'POST',
        headers: { 'X-CSRF-TOKEN': input.csrfToken || '' },
        body: formData,
      }
    )
    if (!uploadRes.ok) {
      throw new Error(
        input.t('svg_edit_upload_failed', { status: uploadRes.status })
      )
    }

    let uploadedId: string | null = null
    let uploadedHash: string | null = null
    try {
      const data = await uploadRes.clone().json()
      uploadedId = data?.entity_id ?? null
      uploadedHash = data?.hash ?? null
    } catch (e) {
      // Non-JSON response: the upload itself succeeded; continue.
    }

    return { ok: true, uploadedId, uploadedHash }
  } catch (err: any) {
    return { ok: false, error: err?.message ?? 'svg_edit_failed' } }
}
