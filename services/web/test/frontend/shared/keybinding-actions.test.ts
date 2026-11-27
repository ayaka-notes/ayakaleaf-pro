import { expect } from 'chai'
import {
  isValidKeyString,
  keyStringFromKeyboardEvent,
  normalizeKeyBinding,
} from '@/shared/keybinding-actions'

describe('keybinding-actions', function () {
  describe('isValidKeyString', function () {
    it('accepts single-key and modifier bindings', function () {
      for (const v of [
        'k',
        'mod-k',
        'shift-k',
        'alt-k',
        'mod-shift-k',
        'mod-shift-alt-k',
        'Space',
        'mod-Backspace',
        'f2',
        'mod-f2',
      ]) {
        expect(isValidKeyString(v), `should accept ${v}`).to.equal(true)
      }
    })

    it('accepts punctuation keys, as captured from KeyboardEvents', function () {
      // These are the shapes keyStringFromKeyboardEvent produces for common
      // rebindable keys — they must also pass import validation so bindings
      // set in the modal survive reload (server enforces the same grammar).
      for (const key of [
        '/',
        ';',
        "'",
        '[',
        ']',
        '\\',
        '"',
        ',',
        '.',
        '=',
        '+',
        '#',
        '$',
        '&',
        '*',
      ]) {
        expect(isValidKeyString(`mod-${key}`), `should accept mod-${key}`).to.equal(
          true,
        )
      }
      // A dash key is the ambiguous case: the binding 'mod--' must survive
      // validation despite splitting on '-' being ambiguous.
      expect(isValidKeyString('mod--')).to.equal(true)
      expect(isValidKeyString('shift--')).to.equal(true)
    })

    it('rejects empty, multi-key, over-modifier and non-key values', function () {
      for (const v of [
        '',
        'mod',
        'mod-mod',
        'k-j',
        'mod-k-j',
        'mod-mod-mod-mod-k',
        'mod-abc-1',
        'mod-k/k',
        'mod-',
        ' ',
        1,
        null,
        { k: 1 },
      ]) {
        expect(isValidKeyString(v), `should reject ${JSON.stringify(v)}`).to.equal(
          false,
        )
      }
    })

    it('rejects unknown multi-character keys', function () {
      for (const v of ['foo', 'mod-foo', 'super-k']) {
        expect(isValidKeyString(v), `should reject ${v}`).to.equal(false)
      }
    })

    it('agrees with the server grammar: every accepted value matches /^((mod|shift|alt)-){0,3}(<named>|[!-~])$/i', function () {
      const SERVER =
        /^((mod|shift|alt)-){0,3}(space|enter|escape|backspace|delete|home|end|pageup|pagedown|tab|arrowup|arrowdown|arrowleft|arrowright|f1[0-2]|f[1-9]|[!-~])$/i
      const candidates = [
        'k',
        'mod-k',
        'mod-shift-k',
        'mod-/',
        'mod--',
        'shift--',
        'mod-/',
        'mod-=',
        'mod-;',
        'mod-Backspace',
        'mod-Escape',
        'mod-Enter',
        'mod-f2',
        'mod-f12',
        'mod-foo',
        'mod-k-j',
      ]
      for (const v of candidates) {
        expect(
          isValidKeyString(v) === SERVER.test(v),
          `client/server disagreement on ${v}`,
        ).to.equal(true)
      }
    })
  })

  describe('keyStringFromKeyboardEvent', function () {
    const press = (key: string, init: KeyboardEventInit = {}) =>
      keyStringFromKeyboardEvent(
        new KeyboardEvent('keydown', { key, ...init }),
      )

    it('captures mod-/ and the result is valid and stable', function () {
      const ks = press('/', { ctrlKey: true })
      expect(ks).to.equal('mod-/')
      expect(isValidKeyString(ks)).to.equal(true)
      expect(normalizeKeyBinding(ks)).to.equal('mod-/')
    })

    it('captures cmd-+ (meta) with the mod canonical form', function () {
      const ks = press('+', { metaKey: true })
      expect(ks).to.equal('mod-+')
      expect(isValidKeyString(ks)).to.equal(true)
    })

    it('captures mod-- (Ctrl/Cmd + dash) and the result is valid and stable', function () {
      const ks = press('-', { ctrlKey: true })
      expect(ks).to.equal('mod--')
      expect(isValidKeyString(ks)).to.equal(true)
      expect(normalizeKeyBinding(ks)).to.equal('mod--')
    })

    it('lower-cases single letters and ignores modifier-only presses', function () {
      expect(press('K', { metaKey: true })).to.equal('mod-k')
      expect(press('Shift')).to.equal('')
      expect(press('Meta')).to.equal('')
      expect(press('Control')).to.equal('')
    })
  })

  describe('normalizeKeyBinding', function () {
    it('keeps a dash key intact instead of dropping it', function () {
      expect(normalizeKeyBinding('mod--')).to.equal('mod--')
      expect(normalizeKeyBinding('shift--')).to.equal('shift--')
    })

    it('keeps other punctuation keys intact', function () {
      expect(normalizeKeyBinding('mod-/')).to.equal('mod-/')
      expect(normalizeKeyBinding('mod-Backspace')).to.equal('mod-Backspace')
    })

    it('canonicalizes modifiers (alias, case, order)', function () {
      expect(normalizeKeyBinding('ctrl-k')).to.equal('mod-k')
      expect(normalizeKeyBinding('Cmd-K')).to.equal('mod-k')
      expect(normalizeKeyBinding('shift-mod-k')).to.equal('mod-shift-k')
      expect(normalizeKeyBinding('ALT-f2')).to.equal('alt-f2')
      expect(normalizeKeyBinding('k')).to.equal('k')
    })

    it('falls back to the legacy order for non-canonical legacy input', function () {
      expect(normalizeKeyBinding('k-mod')).to.equal('mod-k')
    })

    it('returns empty for empty input', function () {
      expect(normalizeKeyBinding(null)).to.equal('')
      expect(normalizeKeyBinding(undefined)).to.equal('')
      expect(normalizeKeyBinding('')).to.equal('')
    })
  })
})
