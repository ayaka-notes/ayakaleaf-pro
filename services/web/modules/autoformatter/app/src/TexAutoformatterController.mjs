import { spawn } from 'node:child_process'
import { tidy } from 'bibtex-tidy'
import logger from '@overleaf/logger'

const MAX_INPUT_SIZE = 5 * 1024 * 1024 // 5 MB
const BIB_EXTENSIONS = new Set(['.bib'])

function getExtension(filename) {
  if (typeof filename !== 'string') return ''
  const dot = filename.lastIndexOf('.')
  return dot >= 0 ? filename.slice(dot).toLowerCase() : ''
}

async function formatTex(req, res) {
  const { content, filename } = req.body
  if (typeof content !== 'string') {
    return res.status(400).json({ error: 'content must be a string' })
  }
  if (content.length > MAX_INPUT_SIZE) {
    return res.status(400).json({ error: 'content too large' })
  }

  const ext = getExtension(filename)

  try {
    let formatted
    if (BIB_EXTENSIONS.has(ext)) {
      formatted = runBibtexTidy(content)
    } else {
      formatted = await runTexFmt(content)
    }
    res.json({ formatted })
  } catch (err) {
    logger.error({ err, filename }, 'formatting failed')
    res.status(500).json({ error: 'Formatting failed' })
  }
}

function runBibtexTidy(input) {
  // bibtex-tidy: https://github.com/FlamingTempura/bibtex-tidy
  // removeDuplicateFields is disabled: bibtex-tidy 1.15.1 crashes on it in this
  // dependency tree (TypeError: seenFieldsByEntry.getOrInsert is not a function).
  // Re-enable once a fixed release is available.
  const result = tidy(input, {
    curly: true,
    numeric: true,
    align: 14,
    blankLines: true,
    sortFields: true,
    stripEnclosingBraces: true,
    trailingCommas: true,
    removeEmptyFields: true,
    removeDuplicateFields: false,
    encodeUrls: true,
    tidyComments: true,
  })
  return result.bibtex
}

function runTexFmt(input) {
  return new Promise((resolve, reject) => {
    const proc = spawn('tex-fmt', ['--stdin'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 10000,
    })

    const chunks = []
    const stderrChunks = []

    proc.stdout.on('data', chunk => chunks.push(chunk))
    proc.stderr.on('data', chunk => stderrChunks.push(chunk))

    proc.on('error', err => {
      reject(
        new Error(
          `Failed to start tex-fmt. Is it installed? ${err.message}`
        )
      )
    })

    proc.on('close', code => {
      if (code === 0) {
        resolve(Buffer.concat(chunks).toString('utf8'))
      } else {
        const stderr = Buffer.concat(stderrChunks).toString('utf8')
        reject(new Error(`tex-fmt exited with code ${code}: ${stderr}`))
      }
    })

    proc.stdin.write(input)
    proc.stdin.end()
  })
}

export default { formatTex }
