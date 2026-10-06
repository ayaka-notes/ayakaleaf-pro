// A stand-in for github.com and api.github.com, covering the calls the
// github-sync module makes: the OAuth app flow, the user and its orgs, repos
// and the git database (blobs, trees, commits, refs, merges, compare,
// zipball). Everything lives in memory.
//
// Port 443 serves GitHub over TLS. The container joins the toolkit's network
// as github.com and api.github.com, and Overleaf trusts the CA from
// bin/prepare via NODE_EXTRA_CA_CERTS.
//
// Port 8080 is plain HTTP for the tests (http://github-mock:8080/_mock/...):
// reset, seed a repo, read a repo back, commit on the GitHub side, list
// and revoke tokens, change a repo's push permission, and refuse the next
// authorization.

import crypto from 'node:crypto'
import zlib from 'node:zlib'
import { HttpError, listen, send } from './lib/mock-server.mjs'

const CLIENT_ID = process.env.GITHUB_MOCK_CLIENT_ID
const CLIENT_SECRET = process.env.GITHUB_MOCK_CLIENT_SECRET

const USER = { id: 4242, login: 'e2e-octocat', name: 'E2E Octocat' }
const ORG = 'e2e-org'
const OWNERS = [USER.login, ORG]

let state

function reset() {
  state = {
    codes: new Map(), // code -> true
    tokens: new Map(), // token -> { revoked }
    blobs: new Map(), // sha -> Buffer
    trees: new Map(), // sha -> { path: blobSha }
    commits: new Map(), // sha -> { tree, parents, message, author }
    repos: new Map(), // full name -> repo
    denyNextAuthorize: false,
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
      email: `${USER.login}@example.com`,
      date: new Date().toISOString(),
    },
  }
  const sha = objectSha('commit', commit)
  state.commits.set(sha, commit)
  return sha
}

// Commits a { path: content | { base64 } | { randomBytes } | null } change
// on top of the parents, the first of which the tree starts from.
// randomBytes makes a file of that size that does not compress.
function commitFiles(parents, files, message) {
  const entries = parents.length ? { ...treeOf(parents[0]) } : {}
  for (const [path, content] of Object.entries(files)) {
    if (content === null) delete entries[path]
    else if (content.base64)
      entries[path] = putBlob(Buffer.from(content.base64, 'base64'))
    else if (content.randomBytes)
      entries[path] = putBlob(crypto.randomBytes(content.randomBytes))
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
// way GitHub's zipball nests them.
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

function createRepo({ owner, name, description = '', isPrivate = true }) {
  const fullName = `${owner}/${name}`
  const repo = {
    owner,
    name,
    fullName,
    description,
    private: isPrivate,
    defaultBranch: 'main',
    refs: new Map(),
    push: true,
  }
  state.repos.set(fullName, repo)
  return repo
}

function repoJson(repo) {
  return {
    id: Math.abs(
      crypto.createHash('md5').update(repo.fullName).digest().readInt32LE()
    ),
    name: repo.name,
    full_name: repo.fullName,
    owner: { login: repo.owner },
    private: repo.private,
    description: repo.description,
    default_branch: repo.defaultBranch,
    html_url: `https://github.com/${repo.fullName}`,
    permissions: { admin: repo.push, push: repo.push, pull: true },
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
    sha,
    commit: {
      message: commit.message,
      author: commit.author,
      tree: { sha: commit.tree },
    },
    parents: commit.parents.map(parent => ({ sha: parent })),
  }
}

// ----------------------------------------------------------------- access

function requireToken(req) {
  const match = /^(?:Bearer|token) (.+)$/.exec(req.headers.authorization || '')
  const token = match && state.tokens.get(match[1])
  if (!token || token.revoked) throw new HttpError(401, 'Bad credentials')
  return match[1]
}

function repoFor(req, owner, name) {
  requireToken(req)
  const repo = state.repos.get(`${owner}/${name}`)
  if (!repo) throw new HttpError(404, 'Not Found')
  return repo
}

function requirePush(repo) {
  if (!repo.push)
    throw new HttpError(403, 'Resource not accessible by integration')
}

// ------------------------------------------------------------------ github

const github = [
  // github.com: the OAuth app. Authorization is granted right away, like for
  // a user who approved the app before.
  [
    'GET',
    /^\/login\/oauth\/authorize$/,
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
    /^\/login\/oauth\/access_token$/,
    ({ res, body }) => {
      // GitHub answers 200 with an error field for a bad code
      if (
        body.client_id !== CLIENT_ID ||
        body.client_secret !== CLIENT_SECRET
      ) {
        return send(res, 200, { error: 'incorrect_client_credentials' })
      }
      if (!state.codes.delete(body.code)) {
        return send(res, 200, { error: 'bad_verification_code' })
      }
      const token = `gho_${crypto.randomBytes(18).toString('hex')}`
      state.tokens.set(token, { revoked: false })
      send(res, 200, {
        access_token: token,
        token_type: 'bearer',
        scope: 'read:org,repo,workflow',
      })
    },
  ],

  // api.github.com
  [
    'DELETE',
    /^\/applications\/([^/]+)\/token$/,
    ({ req, res, body, params: [clientId] }) => {
      const expected = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString(
        'base64'
      )
      if (
        clientId !== CLIENT_ID ||
        req.headers.authorization !== `Basic ${expected}`
      ) {
        throw new HttpError(401, 'Requires authentication')
      }
      const token = state.tokens.get(body.access_token)
      if (!token) throw new HttpError(404, 'Not Found')
      token.revoked = true
      send(res, 204)
    },
  ],
  [
    'GET',
    /^\/user$/,
    ({ req, res }) => {
      requireToken(req)
      send(res, 200, USER)
    },
  ],
  [
    'POST',
    /^\/graphql$/,
    ({ req, res }) => {
      requireToken(req)
      send(res, 200, {
        data: {
          viewer: {
            login: USER.login,
            organizations: {
              nodes: [{ login: ORG, viewerCanCreateRepositories: true }],
            },
          },
        },
      })
    },
  ],
  [
    'GET',
    /^\/user\/repos$/,
    ({ req, res, url }) => {
      requireToken(req)
      const page = Number(url.searchParams.get('page') || 1)
      const perPage = Number(url.searchParams.get('per_page') || 30)
      const all = [...state.repos.values()].filter(repo =>
        OWNERS.includes(repo.owner)
      )
      const slice = all.slice((page - 1) * perPage, page * perPage)
      const headers = {}
      if (page * perPage < all.length) {
        headers.Link = `<https://api.github.com/user/repos?page=${page + 1}&per_page=${perPage}>; rel="next"`
      }
      send(res, 200, slice.map(repoJson), headers)
    },
  ],
  [
    'POST',
    /^\/(?:user|orgs\/([^/]+))\/repos$/,
    ({ req, res, body, params: [org] }) => {
      requireToken(req)
      const owner = org || USER.login
      if (!OWNERS.includes(owner)) throw new HttpError(404, 'Not Found')
      if (!body.name) throw new HttpError(422, 'Validation Failed')
      if (state.repos.has(`${owner}/${body.name}`)) {
        throw new HttpError(422, 'Repository creation failed.', {
          errors: [
            {
              resource: 'Repository',
              code: 'custom',
              field: 'name',
              message: 'name already exists on this account',
            },
          ],
        })
      }
      const repo = createRepo({
        owner,
        name: body.name,
        description: body.description,
        isPrivate: body.private !== false,
      })
      if (body.auto_init) {
        repo.refs.set(
          repo.defaultBranch,
          commitFiles([], { 'README.md': `# ${body.name}\n` }, 'Initial commit')
        )
      }
      send(res, 201, repoJson(repo))
    },
  ],
  [
    'GET',
    /^\/repos\/([^/]+)\/([^/]+)$/,
    ({ req, res, params: [owner, name] }) => {
      send(res, 200, repoJson(repoFor(req, owner, name)))
    },
  ],
  [
    'POST',
    /^\/repos\/([^/]+)\/([^/]+)\/git\/blobs$/,
    ({ req, res, body, params: [owner, name] }) => {
      requirePush(repoFor(req, owner, name))
      const sha = putBlob(Buffer.from(body.content, body.encoding || 'utf8'))
      send(res, 201, { sha })
    },
  ],
  [
    'POST',
    /^\/repos\/([^/]+)\/([^/]+)\/git\/trees$/,
    ({ req, res, body, params: [owner, name] }) => {
      requirePush(repoFor(req, owner, name))
      const entries = body.base_tree
        ? { ...state.trees.get(body.base_tree) }
        : {}
      for (const entry of body.tree) {
        if (entry.sha === null) delete entries[entry.path]
        else if (!state.blobs.has(entry.sha))
          throw new HttpError(422, 'Invalid tree info')
        else entries[entry.path] = entry.sha
      }
      send(res, 201, { sha: putTree(entries) })
    },
  ],
  [
    'POST',
    /^\/repos\/([^/]+)\/([^/]+)\/git\/commits$/,
    ({ req, res, body, params: [owner, name] }) => {
      requirePush(repoFor(req, owner, name))
      if (!state.trees.has(body.tree))
        throw new HttpError(422, 'Tree SHA does not exist')
      const sha = putCommit({
        tree: body.tree,
        parents: body.parents || [],
        message: body.message,
      })
      send(res, 201, { sha, tree: { sha: body.tree } })
    },
  ],
  [
    'GET',
    /^\/repos\/([^/]+)\/([^/]+)\/git\/commits\/([0-9a-f]+)$/,
    ({ req, res, params: [owner, name, sha] }) => {
      repoFor(req, owner, name)
      const commit = state.commits.get(sha)
      if (!commit) throw new HttpError(404, 'Not Found')
      send(res, 200, {
        sha,
        tree: { sha: commit.tree },
        message: commit.message,
      })
    },
  ],
  [
    'GET',
    /^\/repos\/([^/]+)\/([^/]+)\/git\/trees\/([0-9a-f]+)$/,
    ({ req, res, params: [owner, name, sha] }) => {
      repoFor(req, owner, name)
      // Takes a commit or a tree, like GitHub
      const entries = state.commits.has(sha)
        ? treeOf(sha)
        : state.trees.get(sha)
      if (!entries) throw new HttpError(404, 'Not Found')
      send(res, 200, {
        sha,
        tree: Object.entries(entries).map(([path, blob]) => ({
          path,
          mode: '100644',
          type: 'blob',
          sha: blob,
        })),
        truncated: false,
      })
    },
  ],
  [
    'GET',
    /^\/repos\/([^/]+)\/([^/]+)\/git\/ref\/heads\/(.+)$/,
    ({ req, res, params: [owner, name, branch] }) => {
      const repo = repoFor(req, owner, name)
      const sha = repo.refs.get(branch)
      if (!sha) throw new HttpError(404, 'Not Found')
      send(res, 200, {
        ref: `refs/heads/${branch}`,
        object: { sha, type: 'commit' },
      })
    },
  ],
  [
    'POST',
    /^\/repos\/([^/]+)\/([^/]+)\/git\/refs$/,
    ({ req, res, body, params: [owner, name] }) => {
      const repo = repoFor(req, owner, name)
      requirePush(repo)
      const branch = body.ref.replace(/^refs\/heads\//, '')
      if (repo.refs.has(branch))
        throw new HttpError(422, 'Reference already exists')
      repo.refs.set(branch, body.sha)
      send(res, 201, {
        ref: body.ref,
        object: { sha: body.sha, type: 'commit' },
      })
    },
  ],
  [
    'PATCH',
    /^\/repos\/([^/]+)\/([^/]+)\/git\/refs\/heads\/(.+)$/,
    ({ req, res, body, params: [owner, name, branch] }) => {
      const repo = repoFor(req, owner, name)
      requirePush(repo)
      const current = repo.refs.get(branch)
      if (!current) throw new HttpError(422, 'Reference does not exist')
      if (!body.force && !ancestors(body.sha).has(current)) {
        throw new HttpError(422, 'Update is not a fast forward')
      }
      repo.refs.set(branch, body.sha)
      send(res, 200, {
        ref: `refs/heads/${branch}`,
        object: { sha: body.sha, type: 'commit' },
      })
    },
  ],
  [
    'DELETE',
    /^\/repos\/([^/]+)\/([^/]+)\/git\/refs\/heads\/(.+)$/,
    ({ req, res, params: [owner, name, branch] }) => {
      const repo = repoFor(req, owner, name)
      requirePush(repo)
      if (!repo.refs.delete(branch))
        throw new HttpError(422, 'Reference does not exist')
      send(res, 204)
    },
  ],
  [
    'POST',
    /^\/repos\/([^/]+)\/([^/]+)\/merges$/,
    ({ req, res, body, params: [owner, name] }) => {
      const repo = repoFor(req, owner, name)
      requirePush(repo)
      const base = repo.refs.get(body.base)
      const head = repo.refs.get(body.head)
      if (!base || !head)
        throw new HttpError(404, 'Base or head does not exist')
      if (ancestors(base).has(head)) return send(res, 204)
      const common = mergeBase(base, head)
      const merged = mergeTrees(
        common ? treeOf(common) : {},
        treeOf(base),
        treeOf(head)
      )
      if (!merged) throw new HttpError(409, 'Merge conflict')
      const sha = putCommit({
        tree: putTree(merged),
        parents: [base, head],
        message: body.commit_message || `Merge ${body.head} into ${body.base}`,
      })
      repo.refs.set(body.base, sha)
      send(res, 201, commitJson(sha))
    },
  ],
  [
    'GET',
    /^\/repos\/([^/]+)\/([^/]+)\/compare\/([^.]+)\.\.\.(.+)$/,
    ({ req, res, params: [owner, name, from, to] }) => {
      const repo = repoFor(req, owner, name)
      const base = state.commits.has(from) ? from : repo.refs.get(from)
      const head = state.commits.has(to) ? to : repo.refs.get(to)
      if (!base || !head) throw new HttpError(404, 'Not Found')
      const ahead = commitsBetween(base, head)
      const behind = commitsBetween(head, base)
      const status =
        ahead.length && behind.length
          ? 'diverged'
          : ahead.length
            ? 'ahead'
            : behind.length
              ? 'behind'
              : 'identical'
      send(res, 200, {
        status,
        ahead_by: ahead.length,
        behind_by: behind.length,
        commits: ahead.map(commitJson),
        files: [],
      })
    },
  ],
  [
    'GET',
    /^\/repos\/([^/]+)\/([^/]+)\/contents\/(.+)$/,
    ({ req, res, url, params: [owner, name, path] }) => {
      const repo = repoFor(req, owner, name)
      const ref = url.searchParams.get('ref') || repo.defaultBranch
      const commit = state.commits.has(ref) ? ref : repo.refs.get(ref)
      const blob = commit && treeOf(commit)[path]
      if (!blob) throw new HttpError(404, 'Not Found')
      send(res, 200, state.blobs.get(blob), {
        'Content-Type': 'application/vnd.github.raw',
      })
    },
  ],
  [
    'GET',
    /^\/repos\/([^/]+)\/([^/]+)\/zipball\/(.+)$/,
    ({ req, res, params: [owner, name, ref] }) => {
      const repo = repoFor(req, owner, name)
      const commit = state.commits.has(ref) ? ref : repo.refs.get(ref)
      if (!commit) throw new HttpError(404, 'Not Found')
      const folder = `${owner}-${name}-${commit.slice(0, 7)}`
      send(res, 200, zipball(folder, treeOf(commit)), {
        'Content-Type': 'application/zip',
      })
    },
  ],
]

// ------------------------------------------------------------------ control

const control = [
  [
    'POST',
    /^\/_mock\/reset$/,
    ({ res }) => {
      reset()
      send(res, 204)
    },
  ],
  // Body: { owner?, name, files: { path: content }, private? }, the files as
  // for commits below
  [
    'POST',
    /^\/_mock\/repos$/,
    ({ res, body }) => {
      const repo = createRepo({
        owner: body.owner || USER.login,
        name: body.name,
        isPrivate: body.private !== false,
      })
      const head = commitFiles([], body.files || {}, 'Initial commit')
      repo.refs.set(repo.defaultBranch, head)
      send(res, 201, { fullName: repo.fullName, head })
    },
  ],
  [
    'GET',
    /^\/_mock\/repos\/([^/]+)\/([^/]+)$/,
    ({ res, params: [owner, name] }) => {
      const repo = state.repos.get(`${owner}/${name}`)
      if (!repo) throw new HttpError(404, 'Not Found')
      const head = repo.refs.get(repo.defaultBranch)
      send(res, 200, {
        ...repoJson(repo),
        head,
        branches: Object.fromEntries(repo.refs),
        files: head ? filesAt(head) : {},
        commits: head ? commitsBetween(null, head).map(commitJson) : [],
      })
    },
  ],
  // Body: { files: { path: content | { base64 } | null }, message, merge? }
  // A push to the default branch on GitHub. With merge, a branch name, it is
  // a merge commit of that branch with the given result.
  [
    'POST',
    /^\/_mock\/repos\/([^/]+)\/([^/]+)\/commits$/,
    ({ res, body, params: [owner, name] }) => {
      const repo = state.repos.get(`${owner}/${name}`)
      if (!repo) throw new HttpError(404, 'Not Found')
      const parents = [repo.refs.get(repo.defaultBranch)]
      if (body.merge) {
        if (!repo.refs.has(body.merge))
          throw new HttpError(404, 'No such branch')
        parents.push(repo.refs.get(body.merge))
      }
      const head = commitFiles(
        parents,
        body.files,
        body.message || 'Commit on GitHub'
      )
      repo.refs.set(repo.defaultBranch, head)
      send(res, 201, { head })
    },
  ],
  // Body: { files: { path: content } } - replaces the default branch with a
  // commit that shares no history with it, like a force push
  [
    'POST',
    /^\/_mock\/repos\/([^/]+)\/([^/]+)\/force-push$/,
    ({ res, body, params: [owner, name] }) => {
      const repo = state.repos.get(`${owner}/${name}`)
      if (!repo) throw new HttpError(404, 'Not Found')
      const head = commitFiles([], body.files, body.message || 'Force push')
      repo.refs.set(repo.defaultBranch, head)
      send(res, 201, { head })
    },
  ],
  // Body: { push: boolean }
  [
    'PUT',
    /^\/_mock\/repos\/([^/]+)\/([^/]+)\/permissions$/,
    ({ res, body, params: [owner, name] }) => {
      const repo = state.repos.get(`${owner}/${name}`)
      if (!repo) throw new HttpError(404, 'Not Found')
      repo.push = body.push
      send(res, 204)
    },
  ],
  [
    'GET',
    /^\/_mock\/tokens$/,
    ({ res }) => {
      send(
        res,
        200,
        [...state.tokens.values()].map(({ revoked }) => ({ revoked }))
      )
    },
  ],
  // The user revokes the app's access on GitHub
  [
    'POST',
    /^\/_mock\/tokens\/revoke$/,
    ({ res }) => {
      for (const token of state.tokens.values()) token.revoked = true
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
]

listen({ name: 'github mock', routes: github, control })
