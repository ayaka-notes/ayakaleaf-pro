import { expect } from 'chai'
import {
  generateBuildId,
  getBuildTimestamp,
  getProjectKey,
  isAllowedFilename,
  splitEditorBuildId,
  validateFilename,
  EDITOR_BUILD_ID_REGEX,
} from '../../../app/js/utils.js'
import { InvalidNameError } from '../../../app/js/Errors.js'

describe('utils', function () {
  describe('isAllowedFilename', function () {
    it('accepts the fixed output files', function () {
      for (const name of [
        'output.pdf',
        'output.log',
        'output.synctex.gz',
        'output.overleaf.json',
        'output.tar.gz',
        'history-resync.json.gz',
      ]) {
        expect(isAllowedFilename(name), name).to.equal(true)
      }
    })

    it('accepts nested .blg files with custom names', function () {
      expect(isAllowedFilename('chapters/refs.blg')).to.equal(true)
    })

    it('rejects everything else', function () {
      expect(isAllowedFilename('output.aux')).to.equal(false)
      expect(isAllowedFilename('main.tex')).to.equal(false)
    })
  })

  describe('validateFilename', function () {
    it('rejects path traversal before the allow-list', function () {
      expect(() => validateFilename('../output.pdf')).to.throw(InvalidNameError)
      expect(() => validateFilename('a/../b.blg')).to.throw(InvalidNameError)
    })

    it('rejects names outside the allow-list', function () {
      expect(() => validateFilename('output.aux')).to.throw(InvalidNameError)
    })
  })

  describe('build ids', function () {
    it('round-trips the timestamp through the build id', function () {
      const ts = 1_700_000_000_000
      const buildId = generateBuildId(ts)
      expect(getBuildTimestamp(buildId)).to.equal(ts)
      expect(`00000000-0000-4000-8000-000000000000-${buildId}`).to.match(
        EDITOR_BUILD_ID_REGEX
      )
    })

    it('splits editorId and buildId', function () {
      const editorId = '00000000-0000-4000-8000-000000000000'
      const buildId = '18f0c0ffee-0123456789abcdef'
      expect(splitEditorBuildId(`${editorId}-${buildId}`)).to.deep.equal({
        editorId,
        buildId,
      })
    })
  })

  describe('getProjectKey', function () {
    it('matches the clsi directory layout', function () {
      expect(getProjectKey('p', 'u')).to.equal('p-u')
      expect(getProjectKey('p')).to.equal('p')
      expect(getProjectKey('p', undefined)).to.equal('p')
    })
  })
})
