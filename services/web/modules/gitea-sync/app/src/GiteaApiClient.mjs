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
  url: GITEA_URL,
  apiUrl: GITEA_API_BASE,
} = Settings.giteaSync
// Gitea caps page sizes at [api] MAX_RESPONSE_ITEMS (50 by default) and
// [api] DEFAULT_GIT_TREES_PER_PAGE (1000 by default)
const MAX_PER_PAGE = 50
const MAX_TREE_PER_PAGE = 1000

const REQUEST_TIMEOUT_MS = 60 * 1000
const REQUEST_LONG_TIMEOUT_MS = 600 * 1000

// After creating a pull request Gitea checks its mergeability again in the
// background, and reports it only as `mergeable`, false both while checking
// and on conflicts
const MERGEABLE_POLL_INTERVAL_MS = 500
const MERGEABLE_POLL_ATTEMPTS = 20

// Answers of the merge endpoint when Gitea refuses to merge: no permission,
// not mergeable (conflict, approvals, status checks...), head moved, failed
const MERGE_REFUSED_STATUSES = new Set([405, 409, 422])

// Everything a sync needs, asked for once so that users never relink for a
// missing permission. The repository scope covers repositories, files
// (CI workflows included), branches and pull requests. Gitea checks the
// scope of every category of a route at the level of its method, so
// creating a repository needs write:user (POST /user/repos) or
// write:organization (POST /orgs/{org}/repos) as well
const OAUTH_SCOPES = 'write:user write:organization write:repository'

const maxConcurrency = parseInt(process.env.GITEA_API_MAX_CONCURRENCY, 10) || 5

// Optionally route all server-side Gitea requests through an HTTP proxy
const giteaProxyAgent = process.env.GITEA_SYNC_PROXY_URL
  ? new HttpsProxyAgent(process.env.GITEA_SYNC_PROXY_URL)
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
      giteaProxyAgent ||
      (url => (url.protocol === 'https:' ? httpsAgent : httpAgent)),
  }
}

function buildHeaders(token) {
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'User-Agent': 'Overleaf-CEP-Gitea-Sync',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
}

// repos are addressed by owner/name, branches and file paths keep their slashes
function repoUrl(repoFullName) {
  return `${GITEA_API_BASE}/repos/${repoFullName}`
}

function encodePath(path) {
  return encodeURIComponent(path).replace(/%2F/g, '/')
}

// Error handling
function isRateLimitError(response) {
  return response.status === 429 || response.headers.get('retry-after') != null
}

function parseBody(body) {
  if (typeof body !== 'string') return body
  try {
    return JSON.parse(body)
  } catch {
    return null
  }
}

// POST /user/repos and /orgs/{org}/repos answer 409 when the name is taken
function isRepositoryAlreadyExistsError(err) {
  return err.response?.status === 409
}

function normalizeGiteaError(err, operation) {
  logger.error({ operation }, 'Gitea API request failed')

  if (err.name === 'AbortError') {
    throw new ProviderRequestError('Gitea request timed out', { status: 504 }, err)
  }

  if (!(err instanceof RequestFailedError)) {
    throw new ProviderRequestError('Something wrong with Gitea request', { status: 500 }, err)
  }

  const status = err.response?.status || 500

  if (status === 401) {
    throw new InvalidTokenError('Invalid token', { status }, err)
  }

  if (status === 404) {
    throw new NotFoundError('Not found', { status }, err)
  }

  if (status === 409) {
    if (isRepositoryAlreadyExistsError(err)) {
      throw new AlreadyExistsError('Repository already exists', { status: 422 }, err)
    }
    throw new GitConflictError()
  }

  if (status === 403 || status === 429) {
    if (isRateLimitError(err.response)) throw new RateLimitError('Rate limit exeeded', { status: 429 }, err)
    throw new PermissionDeniedError('Permission denied', { status: 403 }, err)
  }

  throw new ProviderRequestError('Gitea request failed', { status }, err)
}

// wrappers
function fetchGiteaJson(url, options, operation) {
  return fetchJson(url, withProxy(options)).catch(err => {
    normalizeGiteaError(err, operation)
  })
}

function fetchGiteaJsonWithResponse(url, options, operation) {
  return fetchJsonWithResponse(url, withProxy(options)).catch(err => {
    normalizeGiteaError(err, operation)
  })
}

function fetchGiteaNothing(url, options, operation) {
  return fetchNothing(url, withProxy(options)).catch(err => {
    normalizeGiteaError(err, operation)
  })
}

function fetchGiteaStream(url, options, operation) {
  return fetchStream(url, withProxy(options)).catch(err => {
    normalizeGiteaError(err, operation)
  })
}

// Follows Gitea's pagination (page/limit, Link header)
async function fetchAllPages(url, token, operation) {
  let all = []
  let page = 1

  while (true) {
    const pageUrl = new URL(url)
    pageUrl.searchParams.set('page', page.toString())
    pageUrl.searchParams.set('limit', MAX_PER_PAGE.toString())

    const { json, response } = await fetchGiteaJsonWithResponse(pageUrl.toString(), {
      headers: buildHeaders(token),
      signal: AbortSignal.timeout(REQUEST_LONG_TIMEOUT_MS),
    }, operation)

    all = all.concat(json)
    const link = response.headers.get('link') || ''
    if (!link.includes('rel="next"')) break
    page++
  }

  return all
}

// Gitea answers { access_token, refresh_token, expires_in, token_type };
// access tokens expire after [oauth2] ACCESS_TOKEN_EXPIRATION_TIME (1 hour)
function toCredentials(json) {
  if (!json?.access_token) return null
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token || null,
    expiresAt: json.expires_in ? Date.now() + json.expires_in * 1000 : null,
  }
}

function requestToken(params, operation) {
  const { clientID, clientSecret, callbackURL } = Settings.giteaSync
  return fetchGiteaJson(`${GITEA_URL}/login/oauth/access_token`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Overleaf-CEP-Gitea-Sync',
    },
    body: new URLSearchParams({
      ...params,
      client_id: clientID,
      client_secret: clientSecret,
      redirect_uri: callbackURL,
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  }, operation).then(toCredentials)
}

// ---------------------- exports ------------------------------- //

// OAuth
function getOAuth2Url() {
  const oAuthUrl = new URL(`${GITEA_URL}/login/oauth/authorize`)
  oAuthUrl.searchParams.append('client_id', Settings.giteaSync.clientID)
  oAuthUrl.searchParams.append('redirect_uri', Settings.giteaSync.callbackURL)
  oAuthUrl.searchParams.append('response_type', 'code')
  oAuthUrl.searchParams.append('scope', OAUTH_SCOPES)
  return oAuthUrl
}

function exchangeCodeForToken(code) {
  return requestToken({ grant_type: 'authorization_code', code }, 'exchangeCodeForToken')
}

// Gitea issues a new refresh token on every refresh; with [oauth2]
// INVALIDATE_REFRESH_TOKENS on, the old one is spent after this call
function refreshAccessToken(refreshToken) {
  return requestToken({ grant_type: 'refresh_token', refresh_token: refreshToken }, 'refreshAccessToken')
}

// user, orgs, permissions
function getUser(token) {
  return fetchGiteaJson(`${GITEA_API_BASE}/user`, {
    headers: buildHeaders(token),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }, 'getUser').then(({ id, login, full_name: name }) => ({ id, login, name }))
}

// The organizations the user can create repositories in
async function getUserAndOrgs(token) {
  const user = await getUser(token)

  const orgs = await fetchAllPages(`${GITEA_API_BASE}/user/orgs`, token, 'getUserAndOrgs')
  const permissions = await Promise.all(
    orgs.map(org =>
      fetchGiteaJson(`${GITEA_API_BASE}/users/${user.login}/orgs/${org.username}/permissions`, {
        headers: buildHeaders(token),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      }, 'getUserAndOrgs:permissions')
    )
  )

  return {
    user: user.login,
    orgs: orgs.filter((org, i) => permissions[i].can_create_repository).map(org => org.username),
  }
}

// Every sync writes to the default branch, so the user must be allowed to
// push to it; user_can_push accounts for protected branches
async function getPushPermission(token, repoFullName) {
  const repo = await fetchGiteaJson(repoUrl(repoFullName), {
    headers: buildHeaders(token),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  }, 'getPushPermission:repo')

  if (repo.empty || !repo.permissions?.push) return false

  const branch = await fetchGiteaJson(
    `${repoUrl(repoFullName)}/branches/${encodePath(repo.default_branch)}`, {
      headers: buildHeaders(token),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    }, 'getPushPermission:branch')

  return branch.user_can_push === true
}

// repos
async function createRepo(token, { name, description, isPublic, org }) {
  const url = org ? `${GITEA_API_BASE}/orgs/${org}/repos` : `${GITEA_API_BASE}/user/repos`
  // created empty: the first commit of the export creates the default branch
  const repo = await fetchGiteaJson(url, {
    method: 'POST',
    headers: buildHeaders(token),
    json: {
      name,
      description,
      private: !isPublic,
      auto_init: false,
    },
    signal: AbortSignal.timeout(REQUEST_LONG_TIMEOUT_MS)
  }, 'createRepo')

  return {
    full_name: repo.full_name,
    default_branch: repo.default_branch || 'main',
  }
}

// Empty repositories have no default branch and cannot be imported
async function listUserRepos(token) {
  const repos = await fetchAllPages(`${GITEA_API_BASE}/user/repos`, token, 'listUserRepos')

  return repos
    .filter(r => !r.empty)
    .map(r => ({
      name: r.name,
      fullName: r.full_name,
      defaultBranchName: r.default_branch,
    }))
}

// files
// Git LFS is not supported: /raw serves LFS pointers as they are, like the
// archive of an import
function getBlobStream(token, repoFullName, ref, path) {
  const url = new URL(`${repoUrl(repoFullName)}/raw/${encodePath(path)}`)
  url.searchParams.set('ref', ref)

  return fetchGiteaStream(url.toString(), {
    headers: buildHeaders(token),
    signal: AbortSignal.timeout(REQUEST_LONG_TIMEOUT_MS),
  }, 'getBlobStream')
}

// base64 content of a blob, by its git sha
function getBlobContent(token, repoFullName, sha) {
  return fetchGiteaJson(`${repoUrl(repoFullName)}/git/blobs/${sha}`, {
    headers: buildHeaders(token),
    signal: AbortSignal.timeout(REQUEST_LONG_TIMEOUT_MS),
  }, 'getBlobContent').then(r => r.content || '')
}

async function listBlobsAtCommit(token, repoFullName, commit) {
  let entries = []
  let page = 1

  while (true) {
    const url = new URL(`${repoUrl(repoFullName)}/git/trees/${commit}`)
    url.searchParams.set('recursive', 'true')
    url.searchParams.set('page', page.toString())
    url.searchParams.set('per_page', MAX_TREE_PER_PAGE.toString())

    const tree = await fetchGiteaJson(url.toString(), {
      headers: buildHeaders(token),
      signal: AbortSignal.timeout(REQUEST_LONG_TIMEOUT_MS),
    }, 'listBlobsAtCommit')

    entries = entries.concat(tree.tree || [])
    if (!tree.truncated) break
    page++
  }

  return entries
    .filter(entry => entry.type === 'blob')
    .map(entry => ({
      sha: entry.sha,
      path: entry.path
    }))
}

// commits
// files: [{ operation: 'create' | 'update' | 'delete', path, content?, sha? }]
// Gitea rejects the commit when sha is not the file's blob on the branch.
// Commits on top of branch, or creates branch at startSha first
async function createCommit(token, repoFullName, { branch, startSha, files, message }) {
  if (startSha) {
    await fetchGiteaJson(`${repoUrl(repoFullName)}/branches`, {
      method: 'POST',
      headers: buildHeaders(token),
      json: {
        new_branch_name: branch,
        old_ref_name: startSha,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    }, 'createCommit:branch')
  }

  return fetchGiteaJson(`${repoUrl(repoFullName)}/contents`, {
    method: 'POST',
    headers: buildHeaders(token),
    json: {
      branch,
      message,
      files,
    },
    signal: AbortSignal.timeout(REQUEST_LONG_TIMEOUT_MS)
  }, 'createCommit').then(r => r.commit.sha)
}

async function listNewCommitsWithStatus(token, fullName, branchName, fromCommit) {
  // NotFoundError when fromCommit is gone, e.g. after a force push and gc
  await fetchGiteaJson(`${repoUrl(fullName)}/git/commits/${fromCommit}?stat=false&verification=false&files=false`, {
    headers: buildHeaders(token),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  }, 'listNewCommitsWithStatus:commit')

  const head = await getBranchHead(token, fullName, branchName)
  const compare = await compareCommits(token, fullName, fromCommit, head, 'listNewCommitsWithStatus:compare')

  const commits = compare.map(c => ({
    message: c.commit?.message?.trimEnd() || '',
    author: {
      name: c.commit?.author?.name || '',
      email: c.commit?.author?.email || '',
      date: c.commit?.author?.date || '',
    },
    sha: c.sha,
  }))
  // the branch no longer contains the last synced commit
  const diverged = !isAncestor(fromCommit, head, compare)
  return { commits, diverged }
}

// Commits of head since its merge base with base, oldest first. Gitea
// (1.23+) takes commit shas here, and has no merge base API
async function compareCommits(token, repoFullName, base, head, operation) {
  const url = new URL(`${repoUrl(repoFullName)}/compare/${base}...${head}`)
  url.searchParams.set('verification', 'false')
  url.searchParams.set('files', 'false')
  const data = await fetchGiteaJson(url.toString(), {
    headers: buildHeaders(token),
    signal: AbortSignal.timeout(REQUEST_LONG_TIMEOUT_MS)
  }, operation)
  return (data.commits || []).reverse()
}

// Whether ancestor is an ancestor of (or is) head, from compare(ancestor,
// head): when it is, it is the merge base, so a compared commit has it as
// parent; when it is not, no commit after the merge base can have it
function isAncestor(ancestor, head, compared) {
  if (ancestor === head) return true
  return compared.some(c => c.parents?.some(p => p.sha === ancestor))
}

// branches
function getBranchHead(token, repoFullName, branchName) {
  return fetchGiteaJson(`${repoUrl(repoFullName)}/branches/${encodePath(branchName)}`, {
    headers: buildHeaders(token),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  }, 'getBranchHead').then(r => r.commit.id)
}

function deleteBranch(token, repoFullName, branchName) {
  return fetchGiteaNothing(`${repoUrl(repoFullName)}/branches/${encodePath(branchName)}`, {
    method: 'DELETE',
    headers: buildHeaders(token),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  }, 'deleteBranch')
}

// merge
// Gitea has no API to merge a branch without a pull request, so open one
// and merge it right away with the repository's default merge style. When
// Gitea will not merge it (conflict, required approvals or status checks,
// protected branch...), the pull request stays open for the user to finish
// in Gitea and GitConflictError is thrown, which leads to the manual merge
// flow
async function mergeBranch(token, repoFullName, base, head) {
  const repo = await fetchGiteaJson(repoUrl(repoFullName), {
    headers: buildHeaders(token),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  }, 'mergeBranch:repo')

  const pullsUrl = `${repoUrl(repoFullName)}/pulls`
  const pull = await fetchGiteaJson(pullsUrl, {
    method: 'POST',
    headers: buildHeaders(token),
    json: {
      head,
      base,
      title: `Overleaf sync: merge ${head} into ${base}`,
      body: 'Opened by Overleaf Gitea Sync to merge changes from Overleaf.',
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  }, 'mergeBranch:create')

  const pullUrl = `${pullsUrl}/${pull.number}`

  // Gitea tests the merge while creating the pull request, so a conflict
  // shows right away
  if (!pull.mergeable) {
    logger.debug({ repoFullName, number: pull.number }, 'Gitea will not merge')
    throw new GitConflictError('pull request cannot be merged', { webUrl: pull.html_url })
  }

  // Then it checks it again in the background; meanwhile the pull request
  // is not mergeable and the merge answers 405 'Please try again later',
  // as it does for a conflict. Only one that stays unmergeable is left to
  // the user.
  let current = pull
  let merged = false
  for (let attempt = 0; attempt < MERGEABLE_POLL_ATTEMPTS && !merged; attempt++) {
    if (attempt > 0) {
      await sleep(MERGEABLE_POLL_INTERVAL_MS)
      current = await fetchGiteaJson(pullUrl, {
        headers: buildHeaders(token),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      }, 'mergeBranch:status')
    }
    if (!current.mergeable) continue

    try {
      await fetchNothing(`${pullUrl}/merge`, withProxy({
        method: 'POST',
        headers: buildHeaders(token),
        json: {
          Do: repo.default_merge_style || 'merge',
          head_commit_id: current.head.sha,
          delete_branch_after_merge: false,
        },
        signal: AbortSignal.timeout(REQUEST_LONG_TIMEOUT_MS)
      }))
      merged = true
    } catch (err) {
      if (!(err instanceof RequestFailedError) || !MERGE_REFUSED_STATUSES.has(err.response?.status)) {
        normalizeGiteaError(err, 'mergeBranch:merge')
      }
      const message = parseBody(err.body)?.message
      logger.debug({ repoFullName, number: pull.number, status: err.response.status, message },
        'Gitea refused the merge')
      if (message !== 'Please try again later') {
        throw new GitConflictError('pull request was not merged', { webUrl: pull.html_url })
      }
    }
  }

  if (!merged) {
    logger.debug({ repoFullName, number: pull.number }, 'Gitea will not merge')
    throw new GitConflictError('pull request cannot be merged', { webUrl: pull.html_url })
  }

  // the merge commit, or with rebase, squash and fast-forward merges the
  // new head of base
  const done = await fetchGiteaJson(pullUrl, {
    headers: buildHeaders(token),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  }, 'mergeBranch:merged')

  return done.merge_commit_sha
}

// Whether the temporary branch has been merged into base, whose head is
// baseHead: branchHead is an ancestor of baseHead, or a pull request from
// the branch was merged (squash merges leave no ancestor; the branch may have
// moved on when conflicts were resolved in Gitea)
async function isBranchMerged(token, repoFullName, { base, baseHead, branch, branchHead }) {
  try {
    const compared = await compareCommits(token, repoFullName, branchHead, baseHead, 'isBranchMerged:compare')
    if (isAncestor(branchHead, baseHead, compared)) return true
  } catch (err) {
    // 404 when branchHead is gone (unreachable after the branch was deleted)
    if (!(err instanceof NotFoundError)) throw err
  }

  try {
    const pull = await fetchGiteaJson(`${repoUrl(repoFullName)}/pulls/${encodePath(base)}/${encodePath(branch)}`, {
      headers: buildHeaders(token),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    }, 'isBranchMerged:pull')
    return pull.merged === true
  } catch (err) {
    if (err instanceof NotFoundError) return false
    throw err
  }
}

// zip
function getRepoZipball(token, repoFullName, sha) {
  return fetchGiteaStream(`${repoUrl(repoFullName)}/archive/${sha}.zip`, {
    headers: buildHeaders(token),
    signal: AbortSignal.timeout(REQUEST_LONG_TIMEOUT_MS),
  }, 'getRepoZipball')
}

export default {
  maxConcurrency,
  getOAuth2Url,
  exchangeCodeForToken,
  refreshAccessToken,
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
