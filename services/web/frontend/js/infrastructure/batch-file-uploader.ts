import pLimit from 'p-limit'
import getMeta from '@/utils/meta'
import { getErrorMessageForStatusCode } from './http-status-messages'

export type BatchUploadItem = {
  file: Blob
  name: string
  relativePath?: string
}

export type BatchUploadOptions = {
  projectId: string
  folderId: string
  /**
   * Maximum number of uploads to run in parallel.
   * Must be greater than 0; non-positive values fall back to the default of 3.
   */
  concurrency?: number
}

export type UploadResult =
  | {
      status: 'success'
      name: string
      relativePath?: string
      data: unknown
    }
  | {
      status: 'error'
      name: string
      relativePath?: string
      error: string
    }

const DEFAULT_CONCURRENCY = 3

export async function uploadBatch(
  items: BatchUploadItem[],
  options: BatchUploadOptions
): Promise<UploadResult[]> {
  if (items.length === 0) {
    return []
  }

  const concurrency =
    options.concurrency && options.concurrency > 0
      ? options.concurrency
      : DEFAULT_CONCURRENCY
  const limit = pLimit(concurrency)
  return Promise.all(items.map(item => limit(() => uploadOne(item, options))))
}

async function uploadOne(
  item: BatchUploadItem,
  options: BatchUploadOptions
): Promise<UploadResult> {
  const formData = new FormData()
  formData.append('qqfile', item.file, item.name)
  formData.append('name', item.name)
  if (item.relativePath) {
    formData.append('relativePath', item.relativePath)
  }

  const url = `/project/${options.projectId}/upload?folder_id=${options.folderId}`

  try {
    const response = await fetch(url, {
      method: 'POST',
      body: formData,
      headers: {
        'X-CSRF-TOKEN': getMeta('ol-csrfToken'),
      },
    })

    if (!response.ok) {
      const error = await extractErrorMessage(response)
      return {
        status: 'error',
        name: item.name,
        relativePath: item.relativePath,
        error,
      }
    }

    const data = await response.json()
    return {
      status: 'success',
      name: item.name,
      relativePath: item.relativePath,
      data,
    }
  } catch (err) {
    return {
      status: 'error',
      name: item.name,
      relativePath: item.relativePath,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

async function extractErrorMessage(response: Response): Promise<string> {
  try {
    const body = await response.json()
    if (typeof body?.error === 'string') {
      return body.error
    }
  } catch {
    // JSON body not available — fall back to status-code message
  }
  return getErrorMessageForStatusCode(response.status)
}
