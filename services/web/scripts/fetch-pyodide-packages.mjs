/* eslint-disable @overleaf/require-script-runner */
// This script doesn't work with ScriptRunner because it is run during the build process.
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { promisify } from 'node:util'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const execFileAsync = promisify(execFile)

const SERVICE_WEB_DIR = path.resolve(fileURLToPath(import.meta.url), '../..')

// Pinned pyodide release tarball. Keep PYODIDE_VERSION in sync with the
// "pyodide" entry in services/web/package.json. When bumping, update both
// PYODIDE_VERSION and EXPECTED_SHA256 together; fetch the hash via:
//   curl -sL https://api.github.com/repos/pyodide/pyodide/releases/tags/<ver> \
//     | jq -r '.assets[] | select(.name=="pyodide-<ver>.tar.bz2") | .digest'
// (strip the "sha256:" prefix). Cross-check by downloading the tarball and
// running `shasum -a 256 pyodide-<ver>.tar.bz2`.
const PYODIDE_VERSION = '0.29.3'
const EXPECTED_SHA256 =
  '458e8ddbcbb6e21037d3237cd5c5146c451765bc738dfa2249ff34c5140331e4'
const TARGET_DIR = path.join(
  SERVICE_WEB_DIR,
  'public/js/libs/pyodide',
  PYODIDE_VERSION
)
const TARBALL_NAME = `pyodide-${PYODIDE_VERSION}.tar.bz2`
const RELEASE_URL = `https://github.com/pyodide/pyodide/releases/download/${PYODIDE_VERSION}/${TARBALL_NAME}`
const COMPLETE_MARKER = path.join(TARGET_DIR, '.fetch-complete')

async function download(url, dest) {
  console.log(`Downloading ${url}`)
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url}: ${res.status} ${res.statusText}`)
  }
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest))
}

async function sha256(file) {
  const hash = createHash('sha256')
  await pipeline(createReadStream(file), hash)
  return hash.digest('hex')
}

// The version subdir only needs what pyodide fetches via packageBaseUrl
// (wheels, their .metadata sidecars, and lib*.zip shared libraries). Skip
// everything else:
//  - core runtime (pyodide.mjs / asm / stdlib / lock) lives one level up,
//    copied from the npm package by webpack CopyPlugin.
//  - *-tests.tar / test-*.zip: per-package test fixtures and pyodide's own
//    test packages, not used at runtime.
//  - console*.html, python / python.exe / python.bat / python_cli_entry.mjs,
//    README.md: REPL UI, CLI shims, and docs.
const TAR_EXCLUDES = [
  'pyodide.mjs',
  'pyodide.asm.js',
  'pyodide.asm.wasm',
  'python_stdlib.zip',
  'pyodide-lock.json',
  '*-tests.tar',
  'test-*.zip',
  'console*.html',
  'python',
  'python.exe',
  'python.bat',
  'python_cli_entry.mjs',
  'README.md',
]

async function extract(tarball, targetDir) {
  console.log(`Extracting ${path.basename(tarball)}`)
  // Tarball contains a top-level pyodide/ folder; strip it so contents land
  // directly in targetDir.
  await execFileAsync('tar', [
    '-xjf',
    tarball,
    '-C',
    targetDir,
    '--strip-components=1',
    ...TAR_EXCLUDES.map(p => `--exclude=${p}`),
  ])
}

async function main() {
  try {
    await stat(COMPLETE_MARKER)
    console.log(`Pyodide ${PYODIDE_VERSION} already present at ${TARGET_DIR}`)
    return
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
  }

  // A prior run may have left a partial install without the marker; wipe it
  // so extraction starts from a clean directory.
  await rm(TARGET_DIR, { recursive: true, force: true })
  await mkdir(TARGET_DIR, { recursive: true })

  const tarballPath = path.join(TARGET_DIR, TARBALL_NAME)
  try {
    await download(RELEASE_URL, tarballPath)
    const actual = await sha256(tarballPath)
    if (actual !== EXPECTED_SHA256) {
      throw new Error(
        `SHA-256 mismatch for ${TARBALL_NAME}: expected ${EXPECTED_SHA256}, got ${actual}`
      )
    }
    await extract(tarballPath, TARGET_DIR)
    await rm(tarballPath, { force: true })

    const extracted = await readdir(TARGET_DIR)
    if (!extracted.some(name => name.endsWith('.whl'))) {
      throw new Error(
        `Extraction did not produce any wheels under ${TARGET_DIR}`
      )
    }

    await writeFile(COMPLETE_MARKER, '')
  } catch (err) {
    // Leave no partial install behind, so the next run starts clean.
    await rm(TARGET_DIR, { recursive: true, force: true })
    throw err
  }

  console.log(`Pyodide ${PYODIDE_VERSION} ready at ${TARGET_DIR}`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
