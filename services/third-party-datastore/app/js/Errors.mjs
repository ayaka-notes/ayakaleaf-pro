import { RequestFailedError } from '@overleaf/fetch-utils'
import DropboxClient from './DropboxClient.mjs'

// What to do when a job fails:
//  - retry: transient (network, 429, 5xx), retried later, in order
//  - skip: this entity can never be synced (e.g. a name Dropbox disallows)
//  - unlink: the Dropbox account cannot be used any more (credentials
//    rejected, full or suspended), the user has to relink it
//  - fail: anything else, the job is dead-lettered
export const Action = {
  RETRY: 'retry',
  SKIP: 'skip',
  UNLINK: 'unlink',
  FAIL: 'fail',
}

// web rejects updates for a project over the file limit with this code and
// notifies the user itself (ErrorController.TOO_MANY_FILES_ERROR_CODE)
const TOO_MANY_FILES_ERROR_CODE = 'project_has_too_many_files'

function statusOf(err) {
  if (err instanceof RequestFailedError) {
    return err.response.status
  }
  return err?.status
}

export function classify(err) {
  const status = statusOf(err)
  const summary = DropboxClient.errorSummary(err)

  if (err instanceof RequestFailedError) {
    if (status === 422 && err.body?.includes(TOO_MANY_FILES_ERROR_CODE)) {
      return { action: Action.SKIP, reason: TOO_MANY_FILES_ERROR_CODE }
    }
  } else if (typeof status === 'number') {
    // a 401 too (AuthError), so before the other 401s
    if (summary.includes('user_suspended')) {
      return { action: Action.UNLINK, reason: 'user_suspended' }
    }
    // from Dropbox, or from its token endpoint when refreshing
    if (status === 401 || summary === 'invalid_grant') {
      return { action: Action.UNLINK, reason: 'access_denied' }
    }
    if (summary.includes('insufficient_space')) {
      return { action: Action.UNLINK, reason: 'insufficient_space' }
    }
    if (
      summary.includes('disallowed_name') ||
      summary.includes('malformed_path')
    ) {
      return { action: Action.SKIP, reason: summary }
    }
  }

  if (status === undefined || status === 429 || status >= 500) {
    const retryAfter = parseInt(err?.headers?.get?.('retry-after'), 10)
    return {
      action: Action.RETRY,
      retryAfterMs: Number.isNaN(retryAfter) ? undefined : retryAfter * 1000,
    }
  }
  return { action: Action.FAIL, reason: summary }
}

export function isNotFound(err) {
  return /(^|\/)not_found(\/|$)/.test(DropboxClient.errorSummary(err))
}

export function isConflict(err) {
  return /(^|\/)conflict(\/|$)/.test(DropboxClient.errorSummary(err))
}
