import { describe, it, expect } from 'vitest'
import { remotePath } from '../../app/src/WebdavPaths.mjs'

// RF.1 (supervisor decision 2026-08-16): the reviewer report flagged a
// slash/no-slash key mismatch between the push and pull lanes (as CRITICAL).
// Verified false positive: ProjectEntityHandler.getAllDocs/getAllFiles keys
// ARE leading-slash (root folder is seeded '/' and path.join('/', name)
// yields '/name'), and BOTH lanes use exactly that key style. This test pins
// the invariant so a future "fix" cannot silently re-introduce the clobber
// bug that report described.

// (1) inline the 2-line WebdavSync.pollUser derivation:
//     const relativePath = entry.path.slice(projectRoot.length) || '/'
function pollRelativePath(entryPath, projectRoot) {
  return entryPath.slice(projectRoot.length) || '/'
}

describe('webdav key-shape invariants (RF.1 evidence)', () => {
  it('pollUser derivation preserves the leading slash', () => {
    expect(pollRelativePath('/Overleaf/Proj/main.tex', '/Overleaf/Proj')).toBe('/main.tex')
    expect(pollRelativePath('/Overleaf/Proj/sub/x.tex', '/Overleaf/Proj')).toBe('/sub/x.tex')
  })

  it('remotePath joins correctly WITH a leading slash (the real key shape)', () => {
    expect(remotePath('/Overleaf', 'Proj', '/main.tex')).toBe('/Overleaf/Proj/main.tex')
  })

  it('stripping the slash corrupts remote URLs (why RF.1 must not be applied)', () => {
    expect(remotePath('/Overleaf', 'Proj', 'main.tex')).not.toBe('/Overleaf/Proj/main.tex')
  })
})
