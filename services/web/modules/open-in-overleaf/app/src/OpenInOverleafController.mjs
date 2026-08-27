import Path from 'node:path'
import crypto from 'node:crypto'
import archiver from 'archiver'
import { fileURLToPath } from 'node:url'
import settings from '@overleaf/settings'
import logger from '@overleaf/logger'
import { expressify } from '@overleaf/promise-utils'
import SessionManager from '../../../../app/src/Features/Authentication/SessionManager.mjs'
import RedisWrapper from '../../../../app/src/infrastructure/RedisWrapper.mjs'
import OpenInOverleafManager, {
  OpenInOverleafError,
} from './OpenInOverleafManager.mjs'

const __dirname = Path.dirname(fileURLToPath(import.meta.url))

const rclient = RedisWrapper.client('open_in_overleaf')
const RESUME_TTL_SECONDS = 10 * 60
const RESUME_TOKEN_REGEX = /^[0-9a-f-]{36}$/
const resumeKey = token => `open-in-overleaf:resume:${token}`

function toArray(value) {
  if (value == null) return []
  return Array.isArray(value) ? value : [value]
}

function firstString(value) {
  const v = Array.isArray(value) ? value[0] : value
  return typeof v === 'string' && v.length ? v : undefined
}

// snip_uri / snip_uri[] (+ matching snip_name / snip_name[]) → [{ url, name }].
function normalizeUris(uris, names) {
  const urlList = toArray(uris).filter(u => typeof u === 'string' && u.length)
  const nameList = toArray(names)
  return urlList.map((url, i) => ({
    url,
    name: typeof nameList[i] === 'string' ? nameList[i] : undefined,
  }))
}

// Accept the API parameters from either a POST body or a GET query string,
// mirroring the official /docs endpoint.
function parseParams(req) {
  const src = { ...req.query, ...req.body }

  let snippet = null
  if (src.encoded_snip != null) {
    try {
      snippet = decodeURIComponent(src.encoded_snip)
    } catch (e) {
      snippet = String(src.encoded_snip)
    }
  } else if (src.snip != null) {
    snippet = String(src.snip)
  }

  return {
    snippet,
    snipUris: normalizeUris(src.snip_uri, src.snip_name),
    zipUri: firstString(src.zip_uri),
    engine: firstString(src.engine),
    mainDocument: firstString(src.main_document),
    projectName: firstString(src.name) || firstString(src.project_name),
  }
}

// POST /docs from a signed-out browser, or a cross-site form whose SameSite=Lax
// session cookie is not sent: requireLogin would redirect to /login keeping
// only the path, dropping the body. Park the submission in redis and redirect
// to a GET carrying the token; the cookie-bearing top-level GET (or the login
// round trip) then resumes with the full input. Nothing is written to
// req.session here on purpose: a fresh session cookie in this response would
// overwrite the browser's existing login.
async function stashForLogin(req, res, next) {
  if (SessionManager.isUserLoggedIn(req.session)) return next()
  const token = crypto.randomUUID()
  await rclient.setex(
    resumeKey(token),
    RESUME_TTL_SECONDS,
    JSON.stringify(parseParams(req))
  )
  res.redirect(`/docs?resume=${token}`)
}

async function loadResumedParams(token) {
  const key = resumeKey(token)
  // single use: read and delete atomically
  const [json] = await rclient.multi().get(key).del(key).exec()
  if (!json) {
    throw new OpenInOverleafError(
      'This Open in Overleaf link has expired, please submit it again.'
    )
  }
  return JSON.parse(json)
}

async function openInOverleaf(req, res) {
  const ownerId = SessionManager.getLoggedInUserId(req.session)

  try {
    const { resume } = req.query
    const params =
      typeof resume === 'string' && RESUME_TOKEN_REGEX.test(resume)
        ? await loadResumedParams(resume)
        : parseParams(req)
    const project = await OpenInOverleafManager.createProject(params, ownerId)
    return res.redirect(`/project/${project._id}`)
  } catch (err) {
    logger.warn({ err }, 'open-in-overleaf: failed to create project')
    const message =
      err instanceof OpenInOverleafError
        ? err.message
        : 'Sorry, something went wrong loading this project into Overleaf.'
    return res.status(422).render(Path.resolve(__dirname, '../views/error'), {
      title: 'Open in Overleaf',
      message,
    })
  }
}

// A minimal multi-file project, zipped in memory once at startup so the /devs
// page can offer a working "zipped project" example without a binary fixture.
function buildZip(files) {
  return new Promise((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 9 } })
    const chunks = []
    archive.on('data', chunk => chunks.push(chunk))
    archive.on('error', reject)
    archive.on('end', () => resolve(Buffer.concat(chunks)))
    for (const [name, content] of Object.entries(files)) {
      archive.append(content, { name })
    }
    archive.finalize()
  })
}

// The same three files as the example archive on the official /devs page.
const demoZipB64 = buildZip({
  'main.tex': [
    '\\documentclass{article}',
    '\\usepackage{subfiles}',
    '\\title{I am a Zip file}',
    '\\author{Overleaf}',
    '\\date{June 2023}',
    '\\begin{document}',
    '\\maketitle',
    '\\section{Introduction}',
    '\\subfile{main2}',
    '\\subsection{How to add Citations and a References List}',
    'Citation example: \\cite{greenwade93}',
    '\\bibliographystyle{alpha}',
    '\\bibliography{sample}',
    '\\end{document}',
    '',
  ].join('\n'),
  'sample.bib': [
    '@article{greenwade93,',
    '    author  = "George D. Greenwade",',
    '    title   = "The {C}omprehensive {T}ex {A}rchive {N}etwork ({CTAN})",',
    '    year    = "1993",',
    '    journal = "TUGBoat",',
    '    volume  = "14",',
    '    number  = "3",',
    '    pages   = "342--351"',
    '}',
    '',
  ].join('\n'),
  'main2.tex': [
    '\\documentclass[./main.tex]{subfiles}',
    '\\begin{document}',
    '\\textbf{Hello from another file!}',
    '\\end{document}',
    '',
  ].join('\n'),
}).then(buffer => buffer.toString('base64'))

// The /devs documentation page ("Overleaf API").
async function devsPage(req, res) {
  const baseUrl = settings.siteUrl || `${req.protocol}://${req.get('host')}`
  res.render(Path.resolve(__dirname, '../views/devs'), {
    title: 'Overleaf API',
    olBaseUrl: baseUrl,
    olDemoZipB64: await demoZipB64,
  })
}

export default {
  stashForLogin: expressify(stashForLogin),
  openInOverleaf: expressify(openInOverleaf),
  devsPage: expressify(devsPage),
}
