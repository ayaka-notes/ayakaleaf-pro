import { expect } from 'vitest'
import {
  buildMainColorCss,
  normalizeMainColor,
} from '../../../../app/src/infrastructure/MainColor.mjs'

describe('MainColor', function () {
  describe('normalizeMainColor', function () {
    it('normalizes six character hex colors', function () {
      expect(normalizeMainColor(' #A1B2C3 ')).to.equal('#a1b2c3')
    })

    it('expands three character hex colors', function () {
      expect(normalizeMainColor('#abc')).to.equal('#aabbcc')
    })

    it('rejects invalid values', function () {
      expect(normalizeMainColor('red')).to.be.null
      expect(normalizeMainColor('var(--green-50)')).to.be.null
      expect(normalizeMainColor('#12345g')).to.be.null
      expect(normalizeMainColor('}; body { display: none')).to.be.null
    })
  })

  describe('buildMainColorCss', function () {
    it('returns null when the color is invalid', function () {
      expect(buildMainColorCss('red')).to.be.null
    })

    it('builds CSS custom property overrides from the main color', function () {
      const css = buildMainColorCss('#123456')

      expect(css).to.contain('--ol-main-color: #123456;')
      expect(css).to.contain('--green-50: #123456;')
      expect(css).to.contain('--bg-accent-01: var(--green-50);')
      expect(css).to.contain('--link-web-hover: var(--green-70);')
    })
  })
})
