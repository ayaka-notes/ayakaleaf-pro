// A stand-in for a self-managed GitLab at gitlab.example.com, covering the
// calls the gitlab-sync module makes: the OAuth application flow (with
// expiring access tokens and rotating refresh tokens), the user and its
// groups, projects, the repository (branches, commits API, tree, blobs,
// compare, merge base, archive) and merge requests. Everything lives in
// memory.
//
// Port 443 serves GitLab over TLS. The container joins the toolkit's network
// as gitlab.example.com, and Overleaf trusts the CA from bin/prepare via
// NODE_EXTRA_CA_CERTS.
//
// Port 8080 is plain HTTP for the tests (http://gitlab-mock:8080/_mock/...):
// reset, seed a project, read a project back, commit on the GitLab side,
// list and revoke tokens, change the access token lifetime, change a
// project's permissions and merge rules, and refuse the next authorization.

import crypto from 'node:crypto'
import zlib from 'node:zlib'
import { HttpError, listen, send } from './lib/mock-server.mjs'

const CLIENT_ID = process.env.GITLAB_MOCK_CLIENT_ID
const CLIENT_SECRET = process.env.GITLAB_MOCK_CLIENT_SECRET
const WEB_URL = 'https://gitlab.example.com'

const USER = { id: 4242, username: 'e2e-tanuki', name: 'E2E Tanuki' }
const GROUP = { id: 77, full_path: 'e2e-group' }
const NAMESPACES = [USER.username, GROUP.full_path]

let state

function reset() {
  state = {
    codes: new Map(), // code -> true
    tokens: new Map(), // access token -> { revoked, expiresAt }
    refreshTokens: new Map(), // refresh token -> { spent }
    tokenTtl: 7200, // seconds, like GitLab
    refreshes: 0,
    blobs: new Map(), // sha -> Buffer
    lfsObjects: new Map(), // sha of the pointer blob -> Buffer of the file
    trees: new Map(), // sha -> { path: blobSha }
    commits: new Map(), // sha -> { tree, parents, message, author }
    repos: new Map(), // path with namespace -> repo
    denyNextAuthorize: false,
    nextDownloadDelay: 0, // ms
  }
}
reset()

// ---------------------------------------------------------------- git model

function gitBlobSha(buffer) {
  return crypto
    .createHash('sha1')
    .update(`blob ${buffer.length}\0`)
    .update(buffer)
    .digest('hex')
}

function objectSha(kind, value) {
  return crypto
    .createHash('sha1')
    .update(`${kind} ${JSON.stringify(value)} ${crypto.randomUUID()}`)
    .digest('hex')
}

function putBlob(buffer) {
  const sha = gitBlobSha(buffer)
  state.blobs.set(sha, buffer)
  return sha
}

function putTree(entries) {
  const sha = objectSha('tree', entries)
  state.trees.set(sha, entries)
  return sha
}

function putCommit({ tree, parents, message }) {
  const commit = {
    tree,
    parents,
    message,
    author: {
      name: USER.name,
      email: `${USER.username}@example.com`,
      date: new Date().toISOString(),
    },
  }
  const sha = objectSha('commit', commit)
  state.commits.set(sha, commit)
  return sha
}

// A Git LFS pointer to the file, which the tree holds instead of it
function putLfsObject(buffer) {
  const oid = crypto.createHash('sha256').update(buffer).digest('hex')
  const pointer = `version https://git-lfs.github.com/spec/v1\noid sha256:${oid}\nsize ${buffer.length}\n`
  const sha = putBlob(Buffer.from(pointer))
  state.lfsObjects.set(sha, buffer)
  return sha
}

// Commits a { path: content | { base64 } | { randomBytes } | { lfs } | null }
// change on top of the parents, the first of which the tree starts from.
// randomBytes makes a file of that size that does not compress; lfs, a file
// tracked by Git LFS with that content.
function commitFiles(parents, files, message) {
  const entries = parents.length ? { ...treeOf(parents[0]) } : {}
  for (const [path, content] of Object.entries(files)) {
    if (content === null) delete entries[path]
    else if (content.base64)
      entries[path] = putBlob(Buffer.from(content.base64, 'base64'))
    else if (content.randomBytes)
      entries[path] = putBlob(crypto.randomBytes(content.randomBytes))
    else if (content.lfs) entries[path] = putLfsObject(Buffer.from(content.lfs))
    else entries[path] = putBlob(Buffer.from(content))
  }
  return putCommit({ tree: putTree(entries), parents, message })
}

function treeOf(commitSha) {
  return state.trees.get(state.commits.get(commitSha).tree)
}

// Every commit reachable from sha, none for null
function ancestors(sha) {
  const seen = new Set()
  const queue = sha ? [sha] : []
  while (queue.length) {
    const next = queue.shift()
    if (seen.has(next)) continue
    seen.add(next)
    queue.push(...state.commits.get(next).parents)
  }
  return seen
}

// Nearest common ancestor, by breadth-first search from b
function mergeBase(a, b) {
  const fromA = ancestors(a)
  const queue = [b]
  const seen = new Set()
  while (queue.length) {
    const next = queue.shift()
    if (fromA.has(next)) return next
    if (seen.has(next)) continue
    seen.add(next)
    queue.push(...state.commits.get(next).parents)
  }
  return null
}

// Commits reachable from head but not from base, oldest first
function commitsBetween(base, head) {
  const excluded = ancestors(base)
  const result = []
  const queue = [head]
  const seen = new Set()
  while (queue.length) {
    const next = queue.shift()
    if (excluded.has(next) || seen.has(next)) continue
    seen.add(next)
    result.push(next)
    queue.push(...state.commits.get(next).parents)
  }
  return result.reverse()
}

// Three-way merge of whole files; null when a path changed on both sides
function mergeTrees(base, ours, theirs) {
  const merged = {}
  const paths = new Set([
    ...Object.keys(base),
    ...Object.keys(ours),
    ...Object.keys(theirs),
  ])
  for (const path of paths) {
    const [b, o, t] = [base[path], ours[path], theirs[path]]
    let result
    if (o === t) result = o
    else if (o === b) result = t
    else if (t === b) result = o
    else return null
    if (result) merged[path] = result
  }
  return merged
}

// --------------------------------------------------------------------- zip

// Stored (uncompressed) zip with every file under one top-level folder, the
// way GitLab's archive nests them.
function zipball(folder, entries) {
  const locals = []
  const centrals = []
  let offset = 0
  for (const [path, sha] of Object.entries(entries)) {
    const name = Buffer.from(`${folder}/${path}`)
    const data = state.blobs.get(sha)
    const crc = zlib.crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(name.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    locals.push(local, name, data)
    centrals.push(central, name)
    offset += local.length + name.length + data.length
  }
  const directory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(centrals.length / 2, 8)
  end.writeUInt16LE(centrals.length / 2, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, directory, end])
}

// ------------------------------------------------------------------- repos

// GitLab derives the project path from its name: lowercase, dashes
function slug(name) {
  return name.toLowerCase().replace(/[^a-z0-9_.-]+/g, '-')
}

function createRepo({ namespace, name, description = '', visibility }) {
  const path = slug(name)
  const fullName = `${namespace}/${path}`
  const repo = {
    id: state.repos.size + 1000,
    namespace,
    name,
    path,
    fullName,
    description,
    visibility: visibility || 'private',
    defaultBranch: null,
    refs: new Map(),
    // the user may push to the default branch
    push: true,
    // project owners may delete merge requests, maintainers may not
    owner: namespace === USER.username,
    // merge rules that keep merge requests from being merged
    approvalsRequired: false,
    pipelineRequired: false,
    mergeRequests: new Map(), // iid -> merge request
  }
  state.repos.set(fullName, repo)
  return repo
}

function setRef(repo, branch, sha) {
  repo.refs.set(branch, sha)
  // the first branch of an empty project becomes its default branch
  if (!repo.defaultBranch) repo.defaultBranch = branch
}

function projectJson(repo) {
  return {
    id: repo.id,
    name: repo.name,
    path: repo.path,
    path_with_namespace: repo.fullName,
    namespace: { full_path: repo.namespace },
    description: repo.description,
    visibility: repo.visibility,
    default_branch: repo.defaultBranch,
    web_url: `${WEB_URL}/${repo.fullName}`,
    permissions: {
      project_access: { access_level: repo.owner ? 50 : 40 },
      group_access: null,
    },
  }
}

function filesAt(commitSha) {
  return Object.fromEntries(
    Object.entries(treeOf(commitSha)).map(([path, sha]) => [
      path,
      state.blobs.get(sha).toString('utf8'),
    ])
  )
}

function commitJson(sha) {
  const commit = state.commits.get(sha)
  return {
    id: sha,
    short_id: sha.slice(0, 8),
    title: commit.message.split('\n')[0],
    message: commit.message,
    author_name: commit.author.name,
    author_email: commit.author.email,
    authored_date: commit.author.date,
    parent_ids: commit.parents,
  }
}

// a branch name or a commit sha
function resolveRef(repo, ref) {
  if (state.commits.has(ref)) return ref
  return repo.refs.get(ref) || null
}

// ----------------------------------------------------------------- access

function requireToken(req) {
  const match = /^Bearer (.+)$/.exec(req.headers.authorization || '')
  const token = match && state.tokens.get(match[1])
  if (!token || token.revoked || token.expiresAt < Date.now()) {
    throw new HttpError(401, '401 Unauthorized')
  }
  return match[1]
}

function repoFor(req, id) {
  requireToken(req)
  const repo = state.repos.get(id)
  if (!repo) throw new HttpError(404, '404 Project Not Found')
  return repo
}

// Pushes to the default branch need repo.push, other branches do not
function requirePush(repo, branch) {
  if (branch === repo.defaultBranch && !repo.push) {
    throw new HttpError(403, 'You are not allowed to push into this branch')
  }
}

function issueTokens() {
  const accessToken = crypto.randomBytes(20).toString('hex')
  const refreshToken = crypto.randomBytes(20).toString('hex')
  state.tokens.set(accessToken, {
    revoked: false,
    expiresAt: Date.now() + state.tokenTtl * 1000,
  })
  state.refreshTokens.set(refreshToken, { spent: false, accessToken })
  return {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: state.tokenTtl,
    refresh_token: refreshToken,
    scope: 'api',
    created_at: Math.floor(Date.now() / 1000),
  }
}

// GitLab answers 400 with an OAuth error for a bad grant
function oauthError(res, error) {
  send(res, 400, { error, error_description: error })
}

// ------------------------------------------------------------- merge requests

function mergeRequestStatus(repo, mr) {
  if (mr.state !== 'opened') return 'not_open'
  const base = repo.refs.get(mr.target_branch)
  const head = repo.refs.get(mr.source_branch)
  if (!base || !head) return 'cannot_be_merged'
  const common = mergeBase(base, head)
  const merged = mergeTrees(
    common ? treeOf(common) : {},
    treeOf(base),
    treeOf(head)
  )
  if (!merged) return 'conflict'
  if (repo.approvalsRequired) return 'not_approved'
  if (repo.pipelineRequired) return 'ci_must_pass'
  return 'mergeable'
}

// The first read after creation still says checking, like GitLab's
// asynchronous mergeability check
function mergeRequestJson(repo, mr) {
  const status = mr.checked ? mergeRequestStatus(repo, mr) : 'checking'
  mr.checked = true
  return {
    iid: mr.iid,
    title: mr.title,
    state: mr.state,
    source_branch: mr.source_branch,
    target_branch: mr.target_branch,
    sha: repo.refs.get(mr.source_branch) || mr.sha,
    detailed_merge_status: status,
    merge_commit_sha: mr.merge_commit_sha || null,
    squash_commit_sha: null,
    web_url: `${WEB_URL}/${repo.fullName}/-/merge_requests/${mr.iid}`,
  }
}

function mergeRequestFor(repo, iid) {
  const mr = repo.mergeRequests.get(Number(iid))
  if (!mr) throw new HttpError(404, '404 Not found')
  return mr
}

// ------------------------------------------------------------------ gitlab

const P = '^/api/v4/projects/([^/]+)'

const gitlab = [
  // The OAuth application. Authorization is granted right away, like for a
  // user who approved the application before.
  [
    'GET',
    /^\/oauth\/authorize$/,
    ({ res, url }) => {
      const redirect = new URL(url.searchParams.get('redirect_uri'))
      if (url.searchParams.get('client_id') !== CLIENT_ID) {
        throw new HttpError(400, 'unknown client_id')
      }
      if (state.denyNextAuthorize) {
        state.denyNextAuthorize = false
        redirect.searchParams.set('error', 'access_denied')
      } else {
        const code = crypto.randomBytes(10).toString('hex')
        state.codes.set(code, true)
        redirect.searchParams.set('code', code)
      }
      redirect.searchParams.set('state', url.searchParams.get('state'))
      send(res, 302, undefined, { Location: redirect.toString() })
    },
  ],
  [
    'POST',
    /^\/oauth\/token$/,
    ({ res, body }) => {
      if (
        body.client_id !== CLIENT_ID ||
        body.client_secret !== CLIENT_SECRET
      ) {
        return send(res, 401, { error: 'invalid_client' })
      }
      if (body.grant_type === 'authorization_code') {
        if (!state.codes.delete(body.code)) return oauthError(res, 'invalid_grant')
        return send(res, 200, issueTokens())
      }
      if (body.grant_type === 'refresh_token') {
        const refresh = state.refreshTokens.get(body.refresh_token)
        if (!refresh || refresh.spent) return oauthError(res, 'invalid_grant')
        // GitLab rotates the refresh token and revokes the old access token
        refresh.spent = true
        const old = state.tokens.get(refresh.accessToken)
        if (old) old.revoked = true
        state.refreshes++
        return send(res, 200, issueTokens())
      }
      oauthError(res, 'unsupported_grant_type')
    },
  ],
  [
    'POST',
    /^\/oauth\/revoke$/,
    ({ res, body }) => {
      if (
        body.client_id !== CLIENT_ID ||
        body.client_secret !== CLIENT_SECRET
      ) {
        return send(res, 401, { error: 'invalid_client' })
      }
      const token = state.tokens.get(body.token)
      if (token) token.revoked = true
      send(res, 200, {})
    },
  ],

  // REST API v4
  [
    'GET',
    /^\/api\/v4\/user$/,
    ({ req, res }) => {
      requireToken(req)
      send(res, 200, USER)
    },
  ],
  [
    'GET',
    /^\/api\/v4\/groups$/,
    ({ req, res }) => {
      requireToken(req)
      send(res, 200, [GROUP])
    },
  ],
  [
    'GET',
    /^\/api\/v4\/groups\/([^/]+)$/,
    ({ req, res, params: [path] }) => {
      requireToken(req)
      if (path !== GROUP.full_path) throw new HttpError(404, '404 Group Not Found')
      send(res, 200, GROUP)
    },
  ],
  [
    'GET',
    /^\/api\/v4\/projects$/,
    ({ req, res, url }) => {
      requireToken(req)
      const page = Number(url.searchParams.get('page') || 1)
      const perPage = Number(url.searchParams.get('per_page') || 20)
      const all = [...state.repos.values()].filter(repo =>
        NAMESPACES.includes(repo.namespace)
      )
      const slice = all.slice((page - 1) * perPage, page * perPage)
      const headers = {}
      if (page * perPage < all.length) headers['X-Next-Page'] = `${page + 1}`
      send(res, 200, slice.map(projectJson), headers)
    },
  ],
  [
    'POST',
    /^\/api\/v4\/projects$/,
    ({ req, res, body }) => {
      requireToken(req)
      const namespace = body.namespace_id
        ? body.namespace_id === GROUP.id && GROUP.full_path
        : USER.username
      if (!namespace) throw new HttpError(404, '404 Namespace Not Found')
      if (!body.name) throw new HttpError(400, 'name is missing')
      if (state.repos.has(`${namespace}/${slug(body.name)}`)) {
        throw new HttpError(400, 'Failed to save project', {
          message: {
            name: ['has already been taken'],
            path: ['has already been taken'],
          },
        })
      }
      const repo = createRepo({
        namespace,
        name: body.name,
        description: body.description,
        visibility: body.visibility,
      })
      if (body.initialize_with_readme) {
        setRef(
          repo,
          'main',
          commitFiles([], { 'README.md': `# ${body.name}\n` }, 'Initial commit')
        )
      }
      send(res, 201, projectJson(repo))
    },
  ],
  [
    'GET',
    new RegExp(`${P}$`),
    ({ req, res, params: [id] }) => {
      send(res, 200, projectJson(repoFor(req, id)))
    },
  ],
  [
    'GET',
    new RegExp(`${P}/repository/branches/(.+)$`),
    ({ req, res, params: [id, branch] }) => {
      const repo = repoFor(req, id)
      const sha = repo.refs.get(branch)
      if (!sha) throw new HttpError(404, '404 Branch Not Found')
      send(res, 200, {
        name: branch,
        commit: commitJson(sha),
        default: branch === repo.defaultBranch,
        protected: branch === repo.defaultBranch,
        can_push: branch !== repo.defaultBranch || repo.push,
      })
    },
  ],
  [
    'DELETE',
    new RegExp(`${P}/repository/branches/(.+)$`),
    ({ req, res, params: [id, branch] }) => {
      const repo = repoFor(req, id)
      if (branch === repo.defaultBranch) {
        throw new HttpError(400, 'The default branch cannot be deleted')
      }
      if (!repo.refs.delete(branch)) throw new HttpError(404, '404 Branch Not Found')
      send(res, 204)
    },
  ],
  [
    'GET',
    new RegExp(`${P}/repository/commits/([0-9a-f]+)$`),
    ({ req, res, params: [id, sha] }) => {
      repoFor(req, id)
      if (!state.commits.has(sha)) throw new HttpError(404, '404 Commit Not Found')
      send(res, 200, commitJson(sha))
    },
  ],
  // The commits API: a batch of file actions on top of branch, or on a new
  // branch started at start_sha
  [
    'POST',
    new RegExp(`${P}/repository/commits$`),
    ({ req, res, body, params: [id] }) => {
      const repo = repoFor(req, id)
      // a push on GitLab while Overleaf was preparing this commit
      if (repo.pushBeforeNextCommit) {
        const { files, message } = repo.pushBeforeNextCommit
        delete repo.pushBeforeNextCommit
        const head = commitFiles([repo.refs.get(repo.defaultBranch)], files, message)
        repo.refs.set(repo.defaultBranch, head)
      }
      const { branch } = body
      let parent
      if (body.start_sha) {
        if (repo.refs.has(branch)) {
          throw new HttpError(400, `A branch called '${branch}' already exists`)
        }
        if (!state.commits.has(body.start_sha)) {
          throw new HttpError(400, 'Invalid start sha')
        }
        parent = body.start_sha
      } else {
        parent = repo.refs.get(branch) || null
        if (!parent && repo.refs.size) {
          throw new HttpError(400, 'You can only create or edit files when you are on a branch')
        }
      }
      requirePush(repo, branch)
      if (!body.actions?.length) throw new HttpError(400, 'actions is missing')

      const entries = parent ? treeOf(parent) : {}
      const files = {}
      for (const action of body.actions) {
        const path = action.file_path
        const exists = path in entries
        if (action.action === 'create' && exists) {
          throw new HttpError(400, 'A file with this name already exists')
        }
        if (['update', 'delete'].includes(action.action) && !exists) {
          throw new HttpError(400, "A file with this name doesn't exist")
        }
        // GitLab checks last_commit_id against start_branch, which is unset
        // with start_sha
        if (action.last_commit_id && body.start_sha) {
          throw new HttpError(400, 'last_commit_id is not checked with start_sha')
        }
        // GitLab compares the last commits of the file; comparing its blobs
        // is close enough for the mock
        const known = action.last_commit_id && state.commits.has(action.last_commit_id)
          ? treeOf(action.last_commit_id)[path]
          : undefined
        if (['update', 'delete'].includes(action.action) && known && known !== entries[path]) {
          throw new HttpError(400, `The file has changed since you started editing it: ${path}`)
        }
        files[path] =
          action.action === 'delete'
            ? null
            : { base64: action.encoding === 'base64' ? action.content : Buffer.from(action.content).toString('base64') }
      }
      // empty files: commitFiles treats an empty base64 as text
      for (const [path, content] of Object.entries(files)) {
        if (content && !content.base64) files[path] = ''
      }
      const sha = commitFiles(parent ? [parent] : [], files, body.commit_message)
      setRef(repo, branch, sha)
      send(res, 201, commitJson(sha))
    },
  ],
  [
    'GET',
    new RegExp(`${P}/repository/tree$`),
    ({ req, res, url, params: [id] }) => {
      const repo = repoFor(req, id)
      const commit = resolveRef(repo, url.searchParams.get('ref') || repo.defaultBranch)
      if (!commit) throw new HttpError(404, '404 Tree Not Found')
      const page = Number(url.searchParams.get('page') || 1)
      const perPage = Number(url.searchParams.get('per_page') || 20)
      // blobs only; real GitLab also lists the folders as trees
      const all = Object.entries(treeOf(commit)).map(([path, sha]) => ({
        id: sha,
        name: path.split('/').pop(),
        type: 'blob',
        path,
        mode: '100644',
      }))
      const headers = {}
      if (page * perPage < all.length) headers['X-Next-Page'] = `${page + 1}`
      send(res, 200, all.slice((page - 1) * perPage, page * perPage), headers)
    },
  ],
  [
    'GET',
    new RegExp(`${P}/repository/files/([^/]+)/raw$`),
    async ({ req, res, url, params: [id, path] }) => {
      const repo = repoFor(req, id)
      if (state.nextDownloadDelay) {
        const delay = state.nextDownloadDelay
        state.nextDownloadDelay = 0
        await new Promise(resolve => setTimeout(resolve, delay))
      }
      const commit = resolveRef(repo, url.searchParams.get('ref'))
      const blob = commit && treeOf(commit)[path]
      if (!blob) throw new HttpError(404, '404 File Not Found')
      send(res, 200, state.blobs.get(blob), {
        'Content-Type': 'application/octet-stream',
      })
    },
  ],
  [
    'GET',
    new RegExp(`${P}/repository/blobs/([0-9a-f]+)/raw$`),
    ({ req, res, params: [id, sha] }) => {
      repoFor(req, id)
      const blob = state.blobs.get(sha)
      if (!blob) throw new HttpError(404, '404 Blob Not Found')
      send(res, 200, blob, { 'Content-Type': 'application/octet-stream' })
    },
  ],
  [
    'GET',
    new RegExp(`${P}/repository/merge_base$`),
    ({ req, res, url, params: [id] }) => {
      const repo = repoFor(req, id)
      const names = url.searchParams.getAll('refs[]')
      if (names.length < 2) throw new HttpError(400, 'Provide at least 2 refs')
      const refs = names.map(ref => resolveRef(repo, ref))
      // like GitLab: 400 for unknown refs, 404 for no common ancestor
      const unknown = names.filter((name, i) => !refs[i])
      if (unknown.length) {
        throw new HttpError(400, `Could not find ref: ${unknown.join(', ')}`)
      }
      const common = mergeBase(refs[0], refs[1])
      if (!common) throw new HttpError(404, '404 Merge Base Not Found')
      send(res, 200, commitJson(common))
    },
  ],
  [
    'GET',
    new RegExp(`${P}/repository/compare$`),
    ({ req, res, url, params: [id] }) => {
      const repo = repoFor(req, id)
      const from = resolveRef(repo, url.searchParams.get('from'))
      const to = resolveRef(repo, url.searchParams.get('to'))
      if (!from || !to) throw new HttpError(404, '404 Ref Not Found')
      // straight=false compares from the merge base
      const base =
        url.searchParams.get('straight') === 'true' ? from : mergeBase(from, to)
      send(res, 200, {
        commit: commitJson(to),
        commits: commitsBetween(base, to).map(commitJson),
        diffs: [],
      })
    },
  ],
  [
    'GET',
    new RegExp(`${P}/repository/archive\\.zip$`),
    ({ req, res, url, params: [id] }) => {
      const repo = repoFor(req, id)
      const commit = resolveRef(repo, url.searchParams.get('sha') || repo.defaultBranch)
      if (!commit) throw new HttpError(404, '404 Not Found')
      const folder = `${repo.path}-${commit}-${commit}`
      // like GitLab, the archive has the LFS files instead of their pointers
      // unless include_lfs_blobs=false
      const entries = { ...treeOf(commit) }
      if (url.searchParams.get('include_lfs_blobs') !== 'false') {
        for (const [path, sha] of Object.entries(entries)) {
          if (state.lfsObjects.has(sha)) entries[path] = putBlob(state.lfsObjects.get(sha))
        }
      }
      send(res, 200, zipball(folder, entries), {
        'Content-Type': 'application/zip',
      })
    },
  ],
  [
    'POST',
    new RegExp(`${P}/merge_requests$`),
    ({ req, res, body, params: [id] }) => {
      const repo = repoFor(req, id)
      if (!repo.refs.has(body.source_branch) || !repo.refs.has(body.target_branch)) {
        throw new HttpError(400, 'Invalid source or target branch')
      }
      const iid = repo.mergeRequests.size + 1
      const mr = {
        iid,
        title: body.title,
        state: 'opened',
        source_branch: body.source_branch,
        target_branch: body.target_branch,
        checked: false,
      }
      repo.mergeRequests.set(iid, mr)
      send(res, 201, mergeRequestJson(repo, mr))
    },
  ],
  [
    'GET',
    new RegExp(`${P}/merge_requests$`),
    ({ req, res, url, params: [id] }) => {
      const repo = repoFor(req, id)
      const filters = ['state', 'source_branch', 'target_branch']
        .map(key => [key, url.searchParams.get(key)])
        .filter(([, value]) => value)
      const mergeRequests = [...repo.mergeRequests.values()].filter(mr =>
        filters.every(([key, value]) => mr[key] === value)
      )
      send(res, 200, mergeRequests.map(mr => mergeRequestJson(repo, mr)))
    },
  ],
  [
    'GET',
    new RegExp(`${P}/merge_requests/(\\d+)$`),
    ({ req, res, params: [id, iid] }) => {
      const repo = repoFor(req, id)
      send(res, 200, mergeRequestJson(repo, mergeRequestFor(repo, iid)))
    },
  ],
  [
    'PUT',
    new RegExp(`${P}/merge_requests/(\\d+)/merge$`),
    ({ req, res, body, params: [id, iid] }) => {
      const repo = repoFor(req, id)
      const mr = mergeRequestFor(repo, iid)
      if (!repo.push) throw new HttpError(401, '401 Unauthorized')
      if (mergeRequestStatus(repo, mr) !== 'mergeable') {
        throw new HttpError(405, '405 Method Not Allowed')
      }
      const base = repo.refs.get(mr.target_branch)
      const head = repo.refs.get(mr.source_branch)
      if (body.sha && body.sha !== head) {
        throw new HttpError(409, 'SHA does not match HEAD of source branch')
      }
      const common = mergeBase(base, head)
      const merged = mergeTrees(
        common ? treeOf(common) : {},
        treeOf(base),
        treeOf(head)
      )
      const sha = putCommit({
        tree: putTree(merged),
        parents: [base, head],
        message: `Merge branch '${mr.source_branch}' into '${mr.target_branch}'`,
      })
      repo.refs.set(mr.target_branch, sha)
      mr.state = 'merged'
      mr.merge_commit_sha = sha
      send(res, 200, mergeRequestJson(repo, mr))
    },
  ],
  [
    'DELETE',
    new RegExp(`${P}/merge_requests/(\\d+)$`),
    ({ req, res, params: [id, iid] }) => {
      const repo = repoFor(req, id)
      mergeRequestFor(repo, iid)
      if (!repo.owner) throw new HttpError(403, '403 Forbidden')
      repo.mergeRequests.delete(Number(iid))
      send(res, 204)
    },
  ],
]

// ------------------------------------------------------------------ control

function controlRepo(namespace, path) {
  const repo = state.repos.get(`${namespace}/${path}`)
  if (!repo) throw new HttpError(404, 'Not Found')
  return repo
}

const control = [
  [
    'POST',
    /^\/_mock\/reset$/,
    ({ res }) => {
      reset()
      send(res, 204)
    },
  ],
  // Body: { namespace?, name, files: { path: content } }, the files as for
  // commits below
  [
    'POST',
    /^\/_mock\/repos$/,
    ({ res, body }) => {
      const repo = createRepo({
        namespace: body.namespace || USER.username,
        name: body.name,
      })
      const head = commitFiles([], body.files || {}, 'Initial commit')
      setRef(repo, 'main', head)
      send(res, 201, { fullName: repo.fullName, head })
    },
  ],
  [
    'GET',
    /^\/_mock\/repos\/([^/]+)\/([^/]+)$/,
    ({ res, params: [namespace, path] }) => {
      const repo = controlRepo(namespace, path)
      const head = repo.defaultBranch && repo.refs.get(repo.defaultBranch)
      send(res, 200, {
        ...projectJson(repo),
        head,
        branches: Object.fromEntries(repo.refs),
        files: head ? filesAt(head) : {},
        commits: head ? commitsBetween(null, head).map(commitJson) : [],
        mergeRequests: [...repo.mergeRequests.values()].map(mr => ({
          iid: mr.iid,
          state: mr.state,
          sourceBranch: mr.source_branch,
          targetBranch: mr.target_branch,
        })),
      })
    },
  ],
  // Body: { files: { path: content | { base64 } | null }, message, merge? }
  // A push to the default branch on GitLab. With merge, a branch name, it is
  // a merge commit of that branch with the given result, and the open merge
  // requests from that branch count as merged.
  [
    'POST',
    /^\/_mock\/repos\/([^/]+)\/([^/]+)\/commits$/,
    ({ res, body, params: [namespace, path] }) => {
      const repo = controlRepo(namespace, path)
      const parents = [repo.refs.get(repo.defaultBranch)]
      if (body.merge) {
        if (!repo.refs.has(body.merge))
          throw new HttpError(404, 'No such branch')
        parents.push(repo.refs.get(body.merge))
      }
      const head = commitFiles(
        parents,
        body.files,
        body.message || 'Commit on GitLab'
      )
      repo.refs.set(repo.defaultBranch, head)
      for (const mr of repo.mergeRequests.values()) {
        if (mr.state === 'opened' && mr.source_branch === body.merge) {
          mr.state = 'merged'
          mr.merge_commit_sha = head
        }
      }
      send(res, 201, { head })
    },
  ],
  // Body: { files, message } - a push to the default branch on GitLab that
  // lands right before the next commit through the commits API, after
  // Overleaf read the branch head
  [
    'POST',
    /^\/_mock\/repos\/([^/]+)\/([^/]+)\/push-before-next-commit$/,
    ({ res, body, params: [namespace, path] }) => {
      const repo = controlRepo(namespace, path)
      repo.pushBeforeNextCommit = {
        files: body.files,
        message: body.message || 'Commit on GitLab',
      }
      send(res, 204)
    },
  ],
  // A branch deleted on GitLab
  [
    'DELETE',
    /^\/_mock\/repos\/([^/]+)\/([^/]+)\/branches\/(.+)$/,
    ({ res, url, params: [namespace, path, branch] }) => {
      const repo = controlRepo(namespace, path)
      const head = repo.refs.get(branch)
      if (!head) throw new HttpError(404, 'No such branch')
      repo.refs.delete(branch)
      // ?gc=true also drops the commits no branch reaches any more, as
      // GitHub and GitLab eventually do with unreachable commits
      if (url.searchParams.get('gc') === 'true') {
        const reachable = new Set(
          [...state.repos.values()].flatMap(r =>
            [...r.refs.values()].flatMap(sha => [...ancestors(sha)])
          )
        )
        for (const sha of ancestors(head)) {
          if (!reachable.has(sha)) state.commits.delete(sha)
        }
      }
      send(res, 204)
    },
  ],
  // Body: { files: { path: content } } - replaces the default branch with a
  // commit that shares no history with it, like a force push
  [
    'POST',
    /^\/_mock\/repos\/([^/]+)\/([^/]+)\/force-push$/,
    ({ res, body, params: [namespace, path] }) => {
      const repo = controlRepo(namespace, path)
      const head = commitFiles([], body.files, body.message || 'Force push')
      repo.refs.set(repo.defaultBranch, head)
      send(res, 201, { head })
    },
  ],
  // Body: { push?: boolean, owner?: boolean, approvalsRequired?: boolean,
  // pipelineRequired?: boolean }
  [
    'PUT',
    /^\/_mock\/repos\/([^/]+)\/([^/]+)\/settings$/,
    ({ res, body, params: [namespace, path] }) => {
      const repo = controlRepo(namespace, path)
      for (const key of ['push', 'owner', 'approvalsRequired', 'pipelineRequired']) {
        if (key in body) repo[key] = body[key]
      }
      send(res, 204)
    },
  ],
  [
    'GET',
    /^\/_mock\/tokens$/,
    ({ res }) => {
      send(res, 200, {
        tokens: [...state.tokens.values()].map(({ revoked }) => ({ revoked })),
        refreshes: state.refreshes,
      })
    },
  ],
  // The user revokes the application's access on GitLab
  [
    'POST',
    /^\/_mock\/tokens\/revoke$/,
    ({ res }) => {
      for (const token of state.tokens.values()) token.revoked = true
      for (const refresh of state.refreshTokens.values()) refresh.spent = true
      send(res, 204)
    },
  ],
  // Body: { seconds } - lifetime of the access tokens issued from now on
  [
    'PUT',
    /^\/_mock\/token-ttl$/,
    ({ res, body }) => {
      state.tokenTtl = body.seconds
      send(res, 204)
    },
  ],
  [
    'POST',
    /^\/_mock\/deny-next-authorize$/,
    ({ res }) => {
      state.denyNextAuthorize = true
      send(res, 204)
    },
  ],
  // Body: { ms } - the next file download waits, so a sync stays in the
  // middle of pulling for that long
  [
    'POST',
    /^\/_mock\/delay-next-download$/,
    ({ res, body }) => {
      state.nextDownloadDelay = body.ms
      send(res, 204)
    },
  ],
]

listen({ name: 'gitlab mock', routes: gitlab, control })
