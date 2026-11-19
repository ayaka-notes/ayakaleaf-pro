/**
 * Duplicate a project file: fetch the file's content and re-upload it in
 * the SAME folder under a derived name (report.pdf -> report-1.pdf,
 * report-2.pdf, ... while those names are taken).
 *
 * Runs entirely client-side (standard blob GET + /project/:id/upload
 * POST, the same endpoint the upload flows use). Orchestration is
 * injectable so it can be unit-tested in Node (fetch is passed in; Node 22
 * provides FormData/Blob/Response).
 */

/** "report.pdf" -> { base: "report", ext: "pdf" } */
export function splitFileName(name: string): { base: string; ext: string } {
  const idx = name.lastIndexOf('.')
  if (idx <= 0) {
    return { base: name, ext: '' }
  }
  return { base: name.slice(0, idx), ext: name.slice(idx + 1) }
}

/**
 * Pick the duplicate's name: `<base>-1<ext>`; if that name is already used
 * in the folder (exists(name) === true), `<base>-2<ext>`, ... (bounded).
 */
export function resolveDuplicateName(
  sourceName: string,
  exists: (name: string) => boolean
): string {
  const { base, ext } = splitFileName(sourceName)
  const suffix = ext ? '.' + ext : ''
  let candidate = `${base}-1${suffix}`
  let i = 1
  while (exists(candidate) && i < 100) {
    candidate = `${base}-${i + 1}${suffix}`
    i += 1
  }
  return candidate
}

export interface DuplicateFileInput {
  projectId: string
  /** Authenticated same-origin blob URL: /project/:id/blob/:hash. */
  downloadPath: string
  /** Id of the folder containing the source file (duplicate goes there). */
  folderId: string
  sourceName: string
  /** Name-collision predicate for the target folder. */
  exists?: (name: string) => boolean
  /** Injected fetch (browser default). */
  fetchImpl?: typeof fetch
  /** CSRF token (from ol-csrfToken meta). */
  csrfToken?: string
}

export type DuplicateFileResult =
  | { ok: true; name: string; uploadedId: string | null }
  | { ok: false; error: string }

/**
 * Fetch the source file and upload a copy under the derived name.
 */
export async function duplicateFile(
  input: DuplicateFileInput
): Promise<DuplicateFileResult> {
  const fetchImpl = input.fetchImpl || fetch
  try {
    const res = await fetchImpl(input.downloadPath)
    if (!res.ok) {
      throw new Error(`file fetch failed (HTTP ${res.status})`)
    }
    const blob = await res.blob()

    const name = resolveDuplicateName(
      input.sourceName,
      input.exists || (() => false)
    )

    const formData = new FormData()
    formData.append('qqfile', blob, name)
    formData.append('name', name)

    const uploadRes = await fetchImpl(
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
      throw new Error(`upload failed (HTTP ${uploadRes.status})`)
    }

    let uploadedId: string | null = null
    try {
      const data = await uploadRes.clone().json()
      uploadedId = data?.entity_id ?? null
    } catch (e) {
      // Non-JSON response: the upload itself succeeded; continue.
    }

    return { ok: true, name, uploadedId }
  } catch (err: any) {
    return { ok: false, error: err?.message ?? 'duplicate failed' }
  }
}
