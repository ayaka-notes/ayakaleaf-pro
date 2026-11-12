import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import Path from 'node:path'
import logger from '@overleaf/logger'
import Errors from './Errors.js'
import CommandRunner from './CommandRunner.js'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'

// TypstWordcount — the wordometer-style word count for Typst projects
// (ported from the OlliTeX Go `clsitypst/wordcount` package, which in turn
// ports the pre-golang Node WordcountInjector).
//
// clsi (TeX) runs `texcount` in docker. Typst has no texcount, so we do a
// wordometer-style compile (the texlyre approach): the root resource is
// included by an injected driver document (`__clsi_wc_main.typ`) that
// imports the vendored wordometer under a private alias `wo` and renders
// the counts on a final, marker-only page. The injected artifacts are
// `__clsi_wc_*` files that are removed after the count; the user's
// resources are never mutated.
//
// The rendered-marker TEXT is read with pdfjs-dist (last-pages window) and
// parsed against:
//   TOTAL_WORDS:\s*(\d+)\s*HEADING_WORDS:\s*(\d+)\s*NUM_HEADINGS:\s*(\d+)
// (whitespace is tolerant: pdfjs splits the rendered text into fragments,
// so spaces between tokens are not stable).
//
// Flow (wordcount()):
//   1. prepare the compile dir
//   2. sync resources if the request body (POST /wordcount) carries them;
//      GET (no body) counts the last-synced sources
//   3. the root resource must exist on disk
//      (NotFoundError: "no compiled state to word count: <root> not synced")
//   4. try: inject the wordometer, `typst compile __clsi_wc_main.typ
//      __clsi_wc_out.pdf` (NOT the 'wordcount' compile group — it mounts
//      /compile read-only, texcount parity; the wordometer driver has to
//      write the marker PDF) and read the rendered marker back from the
//      PDF; fall back to `wc -w` when any step fails (degrade, not fail)
//   5. finally: remove the artifacts

const WCMain = '__clsi_wc_main.typ'
const WCWordometer = '__clsi_wordometer.typ'
const WCOutPDF = '__clsi_wc_out.pdf'

const WORDOMETER_MARKER =
  /TOTAL_WORDS:\s*(\d+)\s*HEADING_WORDS:\s*(\d+)\s*NUM_HEADINGS:\s*(\d+)/

const wordometerTyp = fsSync.readFileSync(
  Path.join(import.meta.dirname, 'wordometer.typ'),
  'utf8'
)

function typEscape(s) {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

function buildInjectedDoc(rootResourcePath) {
  return (
    `#import "${typEscape(WCWordometer)}" as wo\n` +
    `#show: wo.word-count\n` +
    `\n` +
    `#include "${typEscape(rootResourcePath)}"\n` +
    `\n` +
    `#pagebreak()\n` +
    `#context {\n` +
    `  let heads = query(heading)\n` +
    `  let headWords = 0\n` +
    `  for h in heads { headWords += wo.word-count-of(h.body).words }\n` +
    `  [WORDOMETER_OUTPUT_START TOTAL_WORDS: #wo.total-words HEADING_WORDS: #headWords NUM_HEADINGS: #heads.len() WORDOMETER_OUTPUT_END]\n` +
    `}\n`
  )
}

async function writeFile(path, content) {
  try {
    await fs.writeFile(path, content, { mode: 0o600 })
  } catch (err) {
    if (err.code === 'ENOENT') {
      await fs.mkdir(Path.dirname(path), { recursive: true, mode: 0o700 })
      await fs.writeFile(path, content, { mode: 0o600 })
    } else {
      throw err
    }
  }
}

function injectWordometer(compileDir, rootResourcePath) {
  return writeFile(Path.join(compileDir, WCWordometer), wordometerTyp).then(
    () =>
      writeFile(
        Path.join(compileDir, WCMain),
        buildInjectedDoc(rootResourcePath)
      )
  )
}

async function removeArtifacts(compileDir) {
  for (const name of [WCMain, WCWordometer, WCOutPDF]) {
    try {
      await fs.unlink(Path.join(compileDir, name))
    } catch (err) {
      if (err.code !== 'ENOENT') throw err
    }
  }
}

/**
 * parseMarkerText matches the rendered marker over rendered PDF text (the
 * text the engine extracts per page; pages are concatenated with spaces).
 * Returns {total, heading, heads, ok}.
 */
function parseMarkerText(text) {
  const m = WORDOMETER_MARKER.exec(text)
  if (!m) {
    return { total: 0, heading: 0, heads: 0, ok: false }
  }
  return {
    total: parseInt(m[1], 10),
    heading: parseInt(m[2], 10),
    heads: parseInt(m[3], 10),
    ok: true,
  }
}

// readPdfMarker reads the rendered marker from a PDF: join per-page text
// (last-pages window — the marker is on the final page) and parse.
async function readPdfMarker(pdfPath) {
  const doc = await getDocument({
    data: new Uint8Array(await fs.readFile(pdfPath)),
    useSystemFonts: true,
    isEvalSupported: false,
    disableFontFace: true,
  }).promise
  try {
    const numPages = doc.numPages
    const start = Math.max(1, numPages - 2)
    let text = ''
    for (let p = start; p <= numPages; p++) {
      const page = await doc.getPage(p)
      const content = await page.getTextContent()
      text += content.items.map(i => i.str).join(' ') + ' '
    }
    const result = parseMarkerText(text)
    return result
  } finally {
    await doc.destroy()
  }
}

function buildWCCommand(file) {
  return [
    'sh',
    '-c',
    `wc -w "$COMPILE_DIR/${file}" || echo "0 /compile/${file}"`,
  ]
}

// parseWordcountOutput: the first /\d+/ run of the `wc -w` "<N> <file>"
// stdout maps to textWords (all other counts 0).
function parseWordcountOutput(stdout) {
  const m = /\d+/.exec(stdout || '')
  return {
    encode: 'utf-8',
    textWords: m ? parseInt(m[0], 10) : 0,
  }
}

/**
 * wordcount — full flow. Mirrors the clsi wordcount result shape the
 * controller embeds (clsi shape: {encode, textWords, headWords, outside,
 * headers, elements, mathInline, mathDisplay, errors, messages}).
 *
 * @param {object} opts
 * @param {string} opts.projectId
 * @param {string} opts.userId
 * @param {string} opts.file
 * @param {string} opts.image
 * @param {object|null} opts.request  compile request body (POST) or null (GET)
 * @param {string} opts.compileDir
 * @param {Function} opts.syncResources  (request, compileDir) => Promise
 */
async function wordcount({
  projectId,
  userId,
  file,
  image,
  request,
  compileDir,
  syncResources,
}) {
  logger.debug(
    { projectId, userId, file, image },
    'running typst wordcount'
  )

  const rootResource =
    file || (request && request.rootResourcePath) || 'main.typ'

  await fs.mkdir(compileDir, { recursive: true })

  if (request && request.resources != null && request.resources.length) {
    await syncResources(request, compileDir)
  }

  let rootExists = false
  try {
    const st = await fs.stat(Path.join(compileDir, rootResource))
    rootExists = st.isFile()
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
  }
  if (!rootExists) {
    throw new Errors.NotFoundError(
      `no compiled state to word count: ${rootResource} not synced`
    )
  }

  const compileName = `${projectId}`
  let artifactsRemoved = false
  try {
    await injectWordometer(compileDir, rootResource)
    artifactsRemoved = false
    // The wordometer driver has to write the marker PDF, so it must run in
    // a group that allows writes (not the read-only 'wordcount' group used
    // by the texcount parity path).
    try {
      await CommandRunner.promises.run(
        compileName,
        ['typst', 'compile', WCMain, WCOutPDF],
        compileDir,
        image,
        (request && request.timeout) || 60 * 1000,
        {},
        'wordcount-inject',
        null
      )
      const result = await readPdfMarker(Path.join(compileDir, WCOutPDF))
      if (result.ok) {
        logger.debug(
          { projectId, userId, totalWords: result.total, headWords: result.heading, numHeadings: result.heads },
          'word count results (wordometer)'
        )
        // `#total-words` includes heading words (verified against
        // wordometer 0.1.5: headings are not subtracted), so keep that
        // parity: textWords = total.
        return {
          encode: 'utf-8',
          textWords: result.total,
          headWords: result.heading,
          headers: result.heads,
        }
      }
      logger.warn(
        { projectId, userId, rootResource },
        'wordometer marker missing; falling back to wc -w'
      )
    } catch (err) {
      logger.warn(
        { err, projectId, userId, rootResource },
        'wordometer wordcount failed; falling back to wc -w'
      )
    }
  } finally {
    if (!artifactsRemoved) {
      try {
        await removeArtifacts(compileDir)
      } catch (err) {
        logger.warn({ err, compileDir }, 'failed to remove wordcount artifacts')
      }
    }
  }

  // wc -w fallback (the 'wordcount' group — read-only mount is fine, wc
  // only reads).
  const { stdout } = await CommandRunner.promises.run(
    compileName,
    buildWCCommand(rootResource),
    compileDir,
    image,
    5 * 60 * 1000,
    {},
    'wordcount',
    null
  )
  return parseWordcountOutput(stdout)
}

export default {
  wordcount,
  injectWordometer,
  removeArtifacts,
  parseMarkerText,
  readPdfMarker,
  buildInjectedDoc,
  buildWCCommand,
  parseWordcountOutput,
  WORDOMETER_MARKER,
}
