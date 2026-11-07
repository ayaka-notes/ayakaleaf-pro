import { setTimeout as sleep } from 'node:timers/promises'
import logger from '@overleaf/logger'
import Settings from '@overleaf/settings'
import { HttpsProxyAgent } from 'https-proxy-agent'

import {
  CustomHttpAgent,
  CustomHttpsAgent,
  fetchJson,
  fetchJsonWithResponse,
  fetchNothing,
  fetchStream,
  RequestFailedError,
} from '@overleaf/fetch-utils'

import {
  InvalidTokenError,
  NotFoundError,
  GitConflictError,
  RateLimitError,
  ProviderRequestError,
  PermissionDeniedError,
  AlreadyExistsError,
} from './GitSyncErrors.mjs'

const {
  url: GITLAB_URL,
  apiUrl: GITLAB_API_BASE,
} = Settings.gitlabSync
const MAX_PER_PAGE = 100  // GitLab REST API limit

const REQUEST_TIMEOUT_MS = 60 * 1000
const REQUEST_LONG_TIMEOUT_MS = 600 * 1000

// GitLab computes the mergeability of a new merge request asynchronously
const MERGE_STATUS_POLL_INTERVAL_MS = 500
const MERGE_STATUS_POLL_ATTEMPTS = 60

// detailed_merge_status (GitLab 15.6+), with merge_status as the fallback
// for older instances
const MERGE_STATUS_PENDING = new Set([
  'checking',
  'unchecked',
  'preparing',
  'approvals_syncing',
  'cannot_be_merged_recheck',
])
const MERGE_STATUS_MERGEABLE = new Set(['mergeable', 'can_be_merged'])

// Answers of the merge endpoint when GitLab refuses to merge: no permission,
// not mergeable (conflict, approvals, pipeline...), head moved, failed
const MERGE_REFUSED_STATUSES = new Set([401, 405, 406, 409, 422])

const maxConcurrency = parseInt(process.env.GITLAB_API_MAX_CONCURRENCY, 10) || 5

// Optionally route all server-side GitLab requests through an HTTP proxy
const gitlabProxyAgent = process.env.GITLAB_SYNC_PROXY_URL
  ? new HttpsProxyAgent(process.env.GITLAB_SYNC_PROXY_URL)
  : undefined

// fetch-utils' default agent gives up connecting after 1s, too short for
// external APIs, so direct requests get a 3s connect timeout instead
const MAX_CONNECT_TIME = 3000
const httpAgent = new CustomHttpAgent({ connectTimeout: MAX_CONNECT_TIME })
const httpsAgent = new CustomHttpsAgent({ connectTimeout: MAX_CONNECT_TIME })

function withProxy(options) {
  return {
    ...options,
    agent:
      gitlabProxyAgent ||
      (url => (url.protocol === 'https:' ? httpsAgent : httpAgent)),
  }
}

function buildHeaders(token) {
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'User-Agent': 'Overleaf-CEP-GitLab-Sync',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

// projects are addressed by their URL-encoded path, e.g. group%2Fproject
function projectUrl(repoFullName) {
  return `${GITLAB_API_BASE}/projects/${encodeURIComponent(repoFullName)}`
}

// Error handling
function isRateLimitError(response) {
  const remaining = response.headers.get('ratelimit-remaining')
  const retryAfter = response.headers.get('retry-after')

  return response.status === 429 || remaining === '0' || retryAfter != null
}

function parseBody(body) {
  if (typeof body !== 'string') return body
  try {
    return JSON.parse(body)
  } catch {
    return null
  }
}

// POST /projects answers 400 { message: { name: ['has already been taken'], ... } }
function isRepositoryAlreadyExistsError(err) {
  if (err.response?.status !== 400) {
    return false
  }

  const message = parseBody(err.body)?.message
  if (!message || typeof message !== 'object') {
    return false
  }

  return ['name', 'path'].some(field =>
    Array.isArray(message[field]) &&
    message[field].some(m => typeof m === 'string' && m.includes('has already been taken'))
  )
}

function normalizeGitLabError(err, operation) {
  logger.error({ operation }, 'GitLab API request failed')

  if (err.name === 'AbortError') {
    throw new ProviderRequestError('GitLab request timed out', { status: 504 }, err)
  }

  if (!(err instanceof RequestFailedError)) {
    throw new ProviderRequestError('Something wrong with GitLab request', { status: 500 }, err)
  }

  const status = err.response?.status || 500

  if (status === 401) {
    throw new InvalidTokenError('Invalid token', { status }, err)
  }

  if (status === 404) {
    throw new NotFoundError('Not found', { status }, err)
  }

  if (status === 409) {
    throw new GitConflictError()
  }

  if (status === 403 || status === 429) {
    if (isRateLimitError(err.response)) throw new RateLimitError('Rate limit exeeded', { status: 429 }, err)
    throw new PermissionDeniedError('Permission denied', { status: 403 }, err)
  }

  if (status === 400) {
    if (isRepositoryAlreadyExistsError(err)) {
      throw new AlreadyExistsError('Repository already exists', { status: 422 }, err)
    }
  }

  throw new ProviderRequestError('GitLab request failed', { status }, err)
}

// wrappers
function fetchGitLabJson(url, options, operation) {
  return fetchJson(url, withProxy(options)).catch(err => {
    normalizeGitLabError(err, operation)
  })
}

function fetchGitLabJsonWithResponse(url, options, operation) {
  return fetchJsonWithResponse(url, withProxy(options)).catch(err => {
    normalizeGitLabError(err, operation)
  })
}

function fetchGitLabNothing(url, options, operation) {
  return fetchNothing(url, withProxy(options)).catch(err => {
    normalizeGitLabError(err, operation)
  })
}

function fetchGitLabStream(url, options, operation) {
  return fetchStream(url, withProxy(options)).catch(err => {
    normalizeGitLabError(err, operation)
  })
}

// Follows GitLab's offset pagination (x-next-page header)
async function fetchAllPages(url, token, operation) {
  let all = []
  let page = 1

  while (page) {
    const pageUrl = new URL(url)
    pageUrl.searchParams.set('page', page.toString())
    pageUrl.searchParams.set('per_page', MAX_PER_PAGE.toString())

    const { json, response } = await fetchGitLabJsonWithResponse(pageUrl.toString(), {
      headers: buildHeaders(token),
      signal: AbortSignal.timeout(REQUEST_LONG_TIMEOUT_MS),
    }, operation)

    all = all.concat(json)
    page = Number(response.headers.get('x-next-page')) || null
  }

  return all
}

// GitLab answers { access_token, refresh_token, expires_in, created_at };
// tokens issued since GitLab 15.0 expire after 2 hours
function toCredentials(json) {
  if (!json?.access_token) return null
  const createdAt = json.created_at ? json.created_at * 1000 : Date.now()
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token || null,
    expiresAt: json.expires_in ? createdAt + json.expires_in * 1000 : null,
  }
}

// ---------------------- exports ------------------------------- //

// OAuth
function getOAuth2Url() {
  const oAuthUrl = new URL(`${GITLAB_URL}/oauth/authorize`)
  oAuthUrl.searchParams.append('client_id', Settings.gitlabSync.clientID)
  oAuthUrl.searchParams.append('redirect_uri', Settings.gitlabSync.callbackURL)
  oAuthUrl.searchParams.append('response_type', 'code')
  oAuthUrl.searchParams.append('scope', 'api')
  return oAuthUrl
}

function exchangeCodeForToken(code) {
  return fetchGitLabJson(`${GITLAB_URL}/oauth/token`, {
    method: 'POST',
    headers: buildHeaders(),
    json: {
      grant_type: 'authorization_code',
      code,
      client_id: Settings.gitlabSync.clientID,
      client_secret: Settings.gitlabSync.clientSecret,
      redirect_uri: Settings.gitlabSync.callbackURL,
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  }, 'exchangeCodeForToken').then(toCredentials)
}

// GitLab rotates the refresh token: the old one is spent after this call
function refreshAccessToken(refreshToken) {
  return fetchGitLabJson(`${GITLAB_URL}/oauth/token`, {
    method: 'POST',
    headers: buildHeaders(),
    json: {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: Settings.gitlabSync.clientID,
      client_secret: Settings.gitlabSync.clientSecret,
      redirect_uri: Settings.gitlabSync.callbackURL,
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  }, 'refreshAccessToken').then(toCredentials)
}

function revokeToken(token) {
  const { clientID, clientSecret } = Settings.gitlabSync
  return fetchGitLabNothing(`${GITLAB_URL}/oauth/revoke`, {
    method: 'POST',
    headers: buildHeaders(),
    json: {
      client_id: clientID,
      client_secret: clientSecret,
      token,
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }, 'revokeToken')
}

// user, groups, permissions
function getUser(token) {
  return fetchGitLabJson(`${GITLAB_API_BASE}/user`, {
    headers: buildHeaders(token),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }, 'getUser').then(({ id, username, name }) => ({ id, login: username, name }))
}

// GitLab groups play the part of GitHub organizations: list the groups the
// user can create projects in (Developer role or higher)
async function getUserAndOrgs(token) {
  const user = await getUser(token)

  const url = new URL(`${GITLAB_API_BASE}/groups`)
  url.searchParams.set('min_access_level', '30')
  const groups = await fetchAllPages(url, token, 'getUserAndOrgs')

  return {
    user: user.login,
    orgs: groups.map(g => g.full_path),
  }
}

// Every sync writes to the default branch, so the user must be allowed to
// push to it; can_push accounts for protected branches and instance admins
async function getPushPermission(token, repoFullName) {
  const project = await fetchGitLabJson(projectUrl(repoFullName), {
    headers: buildHeaders(token),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }, 'getPushPermission:project')

  if (!project.default_branch) return false

  const branch = await fetchGitLabJson(
    `${projectUrl(repoFullName)}/repository/branches/${encodeURIComponent(project.default_branch)}`, {
      headers: buildHeaders(token),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }, 'getPushPermission:branch')

  return branch.can_push === true
}

// repos
async function createRepo(token, { name, description, isPublic, org }) {
  let namespaceId
  if (org) {
    const group = await fetchGitLabJson(`${GITLAB_API_BASE}/groups/${encodeURIComponent(org)}`, {
      headers: buildHeaders(token),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }, 'createRepo:group')
    namespaceId = group.id
  }

  // created empty: the first commit of the export creates the default branch
  const project = await fetchGitLabJson(`${GITLAB_API_BASE}/projects`, {
    method: 'POST',
    headers: buildHeaders(token),
    json: {
      name,
      description,
      visibility: isPublic ? 'public' : 'private',
      initialize_with_readme: false,
      ...(namespaceId && { namespace_id: namespaceId }),
    },
    signal: AbortSignal.timeout(REQUEST_LONG_TIMEOUT_MS)
  }, 'createRepo')

  return {
    full_name: project.path_with_namespace,
    default_branch: project.default_branch || 'main',
  }
}

// Empty projects have no default branch and cannot be imported
async function listUserRepos(token) {
  const url = new URL(`${GITLAB_API_BASE}/projects`)
  url.searchParams.set('membership', 'true')
  url.searchParams.set('simple', 'true')
  url.searchParams.set('order_by', 'last_activity_at')
  const projects = await fetchAllPages(url, token, 'listUserRepos')

  return projects
    .filter(p => p.default_branch)
    .map(p => ({
      name: p.name,
      fullName: p.path_with_namespace,
      defaultBranchName: p.default_branch,
    }))
}

// files
function getBlobStream(token, repoFullName, ref, path) {
  const url = new URL(`${projectUrl(repoFullName)}/repository/files/${encodeURIComponent(path)}/raw`)
  url.searchParams.set('ref', ref)

  return fetchGitLabStream(url.toString(), {
    headers: buildHeaders(token),
    signal: AbortSignal.timeout(REQUEST_LONG_TIMEOUT_MS),
  }, 'getBlobStream')
}

// base64 content of a blob, by its git sha
async function getBlobContent(token, repoFullName, sha) {
  const stream = await fetchGitLabStream(`${projectUrl(repoFullName)}/repository/blobs/${sha}/raw`, {
    headers: buildHeaders(token),
    signal: AbortSignal.timeout(REQUEST_LONG_TIMEOUT_MS),
  }, 'getBlobContent')

  const chunks = []
  for await (const chunk of stream) chunks.push(chunk)
  return Buffer.concat(chunks).toString('base64')
}

function listBlobsAtCommit(token, repoFullName, commit) {
  const url = new URL(`${projectUrl(repoFullName)}/repository/tree`)
  url.searchParams.set('ref', commit)
  url.searchParams.set('recursive', 'true')

  return fetchAllPages(url, token, 'listBlobsAtCommit').then(entries =>
    entries
      .filter(entry => entry.type === 'blob')
      .map(entry => ({
        sha: entry.id,
        path: entry.path
      }))
  )
}

// commits
// actions: [{ action: 'create' | 'update' | 'delete', file_path, content?, encoding? }]
// Commits on top of branch, or creates branch at startSha first
function createCommit(token, repoFullName, { branch, startSha, actions, message }) {
  return fetchGitLabJson(`${projectUrl(repoFullName)}/repository/commits`, {
    method: 'POST',
    headers: buildHeaders(token),
    json: {
      branch,
      commit_message: message,
      actions,
      ...(startSha && { start_sha: startSha }),
    },
    signal: AbortSignal.timeout(REQUEST_LONG_TIMEOUT_MS)
  }, 'createCommit').then(r => r.id)
}

async function listNewCommitsWithStatus(token, fullName, branchName, fromCommit) {
  // NotFoundError when fromCommit is gone, e.g. after a force push and gc
  await fetchGitLabJson(`${projectUrl(fullName)}/repository/commits/${fromCommit}`, {
    headers: buildHeaders(token),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  }, 'listNewCommitsWithStatus:commit')

  const head = await getBranchHead(token, fullName, branchName)

  const mergeBaseUrl = new URL(`${projectUrl(fullName)}/repository/merge_base`)
  mergeBaseUrl.searchParams.append('refs[]', fromCommit)
  mergeBaseUrl.searchParams.append('refs[]', head)
  const mergeBase = await fetchGitLabJson(mergeBaseUrl.toString(), {
    headers: buildHeaders(token),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  }, 'listNewCommitsWithStatus:mergeBase')

  const compareUrl = new URL(`${projectUrl(fullName)}/repository/compare`)
  compareUrl.searchParams.set('from', fromCommit)
  compareUrl.searchParams.set('to', head)
  compareUrl.searchParams.set('straight', 'false')
  const data = await fetchGitLabJson(compareUrl.toString(), {
    headers: buildHeaders(token),
    signal: AbortSignal.timeout(REQUEST_LONG_TIMEOUT_MS)
  }, 'listNewCommitsWithStatus:compare')

  const commits = (data.commits || []).map(c => ({
    message: c.message || '',
    author: {
      name: c.author_name || '',
      email: c.author_email || '',
      date: c.authored_date || '',
    },
    sha: c.id,
  }))
  // the branch no longer contains the last synced commit
  const diverged = mergeBase.id !== fromCommit
  return { commits, diverged }
}

// branches
function getBranchHead(token, repoFullName, branchName) {
  return fetchGitLabJson(`${projectUrl(repoFullName)}/repository/branches/${encodeURIComponent(branchName)}`, {
    headers: buildHeaders(token),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  }, 'getBranchHead').then(r => r.commit.id)
}

function deleteBranch(token, repoFullName, branchName) {
  return fetchGitLabNothing(`${projectUrl(repoFullName)}/repository/branches/${encodeURIComponent(branchName)}`, {
    method: 'DELETE',
    headers: buildHeaders(token),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  }, 'deleteBranch')
}

// merge
// GitLab has no API to merge a branch without a merge request, so open one
// and merge it right away. When GitLab will not merge it (conflict, required
// approvals or pipeline, protected branch...), the merge request stays open
// for the user to finish in GitLab and GitConflictError is thrown, which
// leads to the manual merge flow
async function mergeBranch(token, repoFullName, base, head) {
  const mergeRequestsUrl = `${projectUrl(repoFullName)}/merge_requests`

  const mr = await fetchGitLabJson(mergeRequestsUrl, {
    method: 'POST',
    headers: buildHeaders(token),
    json: {
      source_branch: head,
      target_branch: base,
      title: `Overleaf sync: merge ${head} into ${base}`,
      description: 'Opened by Overleaf GitLab Sync to merge changes from Overleaf.',
      remove_source_branch: false,
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  }, 'mergeBranch:create')

  const mrUrl = `${mergeRequestsUrl}/${mr.iid}`

  let current = mr
  for (let attempt = 0; attempt < MERGE_STATUS_POLL_ATTEMPTS; attempt++) {
    if (!MERGE_STATUS_PENDING.has(mergeStatus(current))) break
    await sleep(MERGE_STATUS_POLL_INTERVAL_MS)
    current = await fetchGitLabJson(`${mrUrl}?with_merge_status_recheck=true`, {
      headers: buildHeaders(token),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    }, 'mergeBranch:status')
  }

  if (!MERGE_STATUS_MERGEABLE.has(mergeStatus(current))) {
    logger.debug({ repoFullName, iid: mr.iid, status: mergeStatus(current) }, 'GitLab will not merge')
    throw new GitConflictError('merge request cannot be merged', { webUrl: mr.web_url })
  }

  let merged
  try {
    merged = await fetchJson(`${mrUrl}/merge`, withProxy({
      method: 'PUT',
      headers: buildHeaders(token),
      json: {
        sha: current.sha,
        should_remove_source_branch: false,
      },
      signal: AbortSignal.timeout(REQUEST_LONG_TIMEOUT_MS)
    }))
  } catch (err) {
    if (err instanceof RequestFailedError && MERGE_REFUSED_STATUSES.has(err.response?.status)) {
      logger.debug({ repoFullName, iid: mr.iid, status: err.response.status }, 'GitLab refused the merge')
      throw new GitConflictError('merge request was not merged', { webUrl: mr.web_url })
    }
    normalizeGitLabError(err, 'mergeBranch:merge')
  }

  // with fast-forward merges there is no merge commit; with squashing the
  // squash commit is the new head
  const mergeCommit = merged.merge_commit_sha || merged.squash_commit_sha || merged.sha

  // Only administrators and project owners may delete merge requests,
  // otherwise the merged one stays
  try {
    await fetchGitLabNothing(mrUrl, {
      method: 'DELETE',
      headers: buildHeaders(token),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    }, 'mergeBranch:delete')
  } catch (err) {
    logger.debug({ err, repoFullName, iid: mr.iid }, 'Delete merged merge request failed')
  }

  return mergeCommit
}

function mergeStatus(mr) {
  return mr.detailed_merge_status || mr.merge_status
}

// Whether the temporary branch has been merged into base, whose head is
// baseHead: branchHead is an ancestor of baseHead, or a merge request from
// the branch was merged (squash merges leave no ancestor; the branch may have
// moved on when conflicts were resolved in GitLab)
async function isBranchMerged(token, repoFullName, { base, baseHead, branch, branchHead }) {
  const mergeBaseUrl = new URL(`${projectUrl(repoFullName)}/repository/merge_base`)
  mergeBaseUrl.searchParams.append('refs[]', branchHead)
  mergeBaseUrl.searchParams.append('refs[]', baseHead)
  try {
    const mergeBase = await fetchGitLabJson(mergeBaseUrl.toString(), {
      headers: buildHeaders(token),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    }, 'isBranchMerged:mergeBase')
    if (mergeBase.id === branchHead) return true
  } catch (err) {
    // 404 when the commits have no common ancestor, 400 when branchHead is
    // gone (unreachable after the branch was deleted)
    const noMergeBase = err instanceof NotFoundError ||
      (err instanceof ProviderRequestError && err.info?.status === 400)
    if (!noMergeBase) throw err
  }

  const mergeRequestsUrl = new URL(`${projectUrl(repoFullName)}/merge_requests`)
  mergeRequestsUrl.searchParams.set('state', 'merged')
  mergeRequestsUrl.searchParams.set('source_branch', branch)
  mergeRequestsUrl.searchParams.set('target_branch', base)
  const mergeRequests = await fetchGitLabJson(mergeRequestsUrl.toString(), {
    headers: buildHeaders(token),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  }, 'isBranchMerged:mergeRequests')
  return mergeRequests.length > 0
}

// zip
function getRepoZipball(token, repoFullName, sha) {
  const url = new URL(`${projectUrl(repoFullName)}/repository/archive.zip`)
  url.searchParams.set('sha', sha)
  // Git LFS is not supported: import LFS pointers as files, like pulls do
  // (GitLab 17.9+, before it the archive always has the LFS files)
  url.searchParams.set('include_lfs_blobs', 'false')

  return fetchGitLabStream(url.toString(), {
    headers: buildHeaders(token),
    signal: AbortSignal.timeout(REQUEST_LONG_TIMEOUT_MS),
  }, 'getRepoZipball')
}

export default {
  maxConcurrency,
  getOAuth2Url,
  exchangeCodeForToken,
  refreshAccessToken,
  revokeToken,
  getUser,
  getUserAndOrgs,
  getPushPermission,
  createRepo,
  listUserRepos,
  getBlobStream,
  getBlobContent,
  listBlobsAtCommit,
  createCommit,
  listNewCommitsWithStatus,
  getBranchHead,
  deleteBranch,
  mergeBranch,
  isBranchMerged,
  getRepoZipball,
}
