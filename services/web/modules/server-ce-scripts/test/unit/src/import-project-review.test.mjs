import { describe, expect, it, vi } from 'vitest'
import { createWriteStream, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import archiver from 'archiver'

vi.doMock(
  '../../../../app/src/Features/Chat/ChatApiHandler.mjs',
  () => ({ default: { promises: {} } })
)
vi.doMock(
  '../../../../app/src/Features/Docstore/DocstoreManager.mjs',
  () => ({ default: { promises: {} } })
)
vi.doMock(
  '../../../../app/src/Features/User/UserGetter.mjs',
  () => ({ default: { promises: {} } })
)
vi.doMock(
  '../../../../app/src/infrastructure/GracefulShutdown.mjs',
  () => ({ gracefulShutdown: () => Promise.resolve() })
)

const {
  REVIEW_JSON_NAME,
  extractJsonFromZip,
  validateReviewState,
} = await import('../../../scripts/import-project-review.mjs')

const THREAD_ID = 'cccccccccccccccccccccccc'
const DOC_ID = 'bbbbbbbbbbbbbbbbbbbbbbbb'
const USER_ID = 'dddddddddddddddddddddddd'

function validState() {
  return {
    format: 'overleaf-comments-and-changes',
    version: 1,
    project_id: 'aaaaaaaaaaaaaaaaaaaaaaaa',
    exported_at: '2026-01-01T00:00:00.000Z',
    docs: [
      {
        id: DOC_ID,
        ranges: {
          comments: [
            {
              id: THREAD_ID,
              op: { c: 'world', p: 4, t: THREAD_ID },
              metadata: { user_id: USER_ID, ts: '2026-01-01T00:00:00.000Z' },
            },
          ],
          changes: [
            {
              id: 'eeeeeeeeeeeeeeee',
              op: { i: 'extra ', p: 0 },
              metadata: { user_id: USER_ID, ts: '2026-01-01T00:00:00.000Z' },
            },
            {
              id: 'ffffffffffffffff',
              op: { d: 'gone ', p: 0 },
              metadata: { user_id: USER_ID, ts: '2026-01-01T00:00:00.000Z' },
            },
          ],
        },
      },
    ],
    threads: {
      [THREAD_ID]: {
        resolved: false,
        resolved_at: null,
        resolved_by_user_id: null,
        messages: [
          { user_id: USER_ID, content: 'world', timestamp: 1767225600000 },
        ],
      },
    },
  }
}

function zipTo(file, entries) {
  return new Promise((resolve, reject) => {
    const output = createWriteStream(file)
    const archive = archiver('zip')
    archive.pipe(output)
    output.on('close', () => resolve(file))
    archive.on('error', reject)
    for (const [name, data] of Object.entries(entries)) {
      archive.append(data, { name })
    }
    archive.finalize()
  })
}

describe('import-project-review', function () {
  describe('validateReviewState', function () {
    it('accepts a valid bundle', function () {
      expect(() => validateReviewState(validState())).not.toThrow()
    })

    it('accepts a bundle without comments, changes or threads', function () {
      const state = validState()
      state.docs = []
      state.threads = {}
      expect(() => validateReviewState(state)).not.toThrow()
    })

    it('rejects an unknown format', function () {
      const state = validState()
      state.format = 'something-else'
      expect(() => validateReviewState(state)).toThrow(/format/)
    })

    it('rejects an unsupported version', function () {
      const state = validState()
      state.version = 2
      expect(() => validateReviewState(state)).toThrow(/version/)
    })

    it('rejects a bad doc id', function () {
      const state = validState()
      state.docs[0].id = 'nope'
      expect(() => validateReviewState(state)).toThrow(/doc id/)
    })

    it('rejects a comment op without text or offset', function () {
      const state = validState()
      state.docs[0].ranges.comments[0].op = { c: 42, p: 'x', t: THREAD_ID }
      expect(() => validateReviewState(state)).toThrow(/comment op/)
    })

    it('rejects a change op that is neither insert nor delete', function () {
      const state = validState()
      state.docs[0].ranges.changes[0].op = { p: 0 }
      expect(() => validateReviewState(state)).toThrow(/change op/)
    })

    it('rejects a change op with a bad offset', function () {
      const state = validState()
      state.docs[0].ranges.changes[0].op = { i: 'x', p: -1 }
      expect(() => validateReviewState(state)).toThrow(/change offset/)
    })

    it('rejects a bad thread id', function () {
      const state = validState()
      state.threads = { nope: state.threads[THREAD_ID] }
      expect(() => validateReviewState(state)).toThrow(/thread id/)
    })

    it('rejects a thread without string message content', function () {
      const state = validState()
      state.threads[THREAD_ID].messages[0].content = 42
      expect(() => validateReviewState(state)).toThrow(/bad message/)
    })
  })

  describe('extractJsonFromZip', function () {
    const stateJson = JSON.stringify(validState())
    let dir

    function tempZip(name) {
      return path.join(dir, name)
    }

    it('finds the JSON at the top level of a project zip', async function () {
      dir = mkdtempSync(path.join(tmpdir(), 'ol-review-'))
      const zip = await zipTo(tempZip('project.zip'), {
        'main.tex': '\\documentclass{article}',
        [REVIEW_JSON_NAME]: stateJson,
      })
      const raw = await extractJsonFromZip(zip)
      expect(JSON.parse(raw.toString('utf8')).format).toEqual(
        'overleaf-comments-and-changes'
      )
    })

    it('finds the JSON inside a nested project zip', async function () {
      dir = mkdtempSync(path.join(tmpdir(), 'ol-review-'))
      const innerFile = tempZip('inner.bin')
      const inner = await zipTo(innerFile, {
        'main.tex': 'text',
        [REVIEW_JSON_NAME]: stateJson,
      })
      const innerBuffer = readFileSync(inner)
      const outer = await zipTo(tempZip('bundle.zip'), {
        'My Project.zip': innerBuffer,
      })
      const raw = await extractJsonFromZip(outer)
      expect(JSON.parse(raw.toString('utf8')).project_id).toEqual(
        'aaaaaaaaaaaaaaaaaaaaaaaa'
      )
    })

    it('throws when no bundle is found', async function () {
      dir = mkdtempSync(path.join(tmpdir(), 'ol-review-'))
      const zip = await zipTo(tempZip('project.zip'), {
        'main.tex': 'text',
      })
      let threw = null
      try {
        await extractJsonFromZip(zip)
      } catch (err) {
        threw = err
      }
      expect(threw).to.not.equal(null)
      expect(threw.message).to.match(/not found in/)
    })
  })
})
