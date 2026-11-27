import { beforeEach, describe, expect, it } from 'vitest'
const modulePath = '../../../../app/src/Features/Project/UserSettingsHelper.mjs'

describe('UserSettingsHelper', function () {
  beforeEach(async function (ctx) {
    ctx.req = { query: {} }
    ctx.res = {}
    ctx.UserSettingsHelper = (await import(modulePath)).default
  })

  describe('overall theme', function () {
    it('should return the overall theme if set', async function (ctx) {
      const user = {
        ace: {
          overallTheme: 'light',
        },
        signUpDate: new Date('2022-01-01'),
      }

      const settings = await ctx.UserSettingsHelper.buildUserSettings(
        ctx.req,
        ctx.res,
        user
      )

      expect(settings.overallTheme).toBe('light')
    })

    it('should return system for new users with no overall theme set', async function (ctx) {
      const user = {
        ace: {},
        signUpDate: new Date('2026-03-16T00:00:00Z'),
      }

      const settings = await ctx.UserSettingsHelper.buildUserSettings(
        ctx.req,
        ctx.res,
        user
      )

      expect(settings.overallTheme).toBe('system')
    })

    it('should return dark for old users with no overall theme set', async function (ctx) {
      const user = {
        ace: {},
        signUpDate: new Date('2025-02-15T00:00:00Z'),
      }

      const settings = await ctx.UserSettingsHelper.buildUserSettings(
        ctx.req,
        ctx.res,
        user
      )

      expect(settings.overallTheme).toBe('')
    })
  })

  describe('reference provider settings', function () {
    it('should drop the _id from group entries', async function (ctx) {
      const user = {
        ace: {
          zotero: {
            enabled: true,
            disablePersonalLibrary: false,
            groups: [{ _id: 'abc123', id: '123' }],
          },
        },
        signUpDate: new Date('2022-01-01'),
      }

      const settings = await ctx.UserSettingsHelper.buildUserSettings(
        ctx.req,
        ctx.res,
        user
      )

      expect(settings.zotero).toEqual({
        enabled: true,
        disablePersonalLibrary: false,
        groups: [{ id: '123' }],
      })
    })

    it('should leave unset providers undefined', async function (ctx) {
      const user = { ace: {}, signUpDate: new Date('2022-01-01') }

      const settings = await ctx.UserSettingsHelper.buildUserSettings(
        ctx.req,
        ctx.res,
        user
      )

      expect(settings.zotero).toBeUndefined()
    })
  })

  describe('comment highlight setting', function () {
    it('should return the stored tags', async function (ctx) {
      const user = {
        ace: {
          highlight: [
            { tag: 'TODO', color: '#ff8c00' },
            { tag: 'NOTE', color: '#00ff00' },
          ],
        },
        signUpDate: new Date('2022-01-01'),
      }

      const settings = await ctx.UserSettingsHelper.buildUserSettings(
        ctx.req,
        ctx.res,
        user
      )

      expect(settings.highlight).toEqual([
        { tag: 'TODO', color: '#ff8c00' },
        { tag: 'NOTE', color: '#00ff00' },
      ])
    })

    it('should fall back to the defaults when unset', async function (ctx) {
      const user = { ace: {}, signUpDate: new Date('2022-01-01') }

      const settings = await ctx.UserSettingsHelper.buildUserSettings(
        ctx.req,
        ctx.res,
        user
      )

      expect(settings.highlight).toEqual(ctx.UserSettingsHelper.DEFAULT_HIGHLIGHT_TAGS)
    })

    it('should fall back to the defaults when the array is empty', async function (ctx) {
      const user = {
        ace: { highlight: [] },
        signUpDate: new Date('2022-01-01'),
      }

      const settings = await ctx.UserSettingsHelper.buildUserSettings(
        ctx.req,
        ctx.res,
        user
      )

      expect(settings.highlight).toEqual(ctx.UserSettingsHelper.DEFAULT_HIGHLIGHT_TAGS)
    })

    it('should migrate the legacy single-object shape', async function (ctx) {
      const user = {
        ace: {
          highlight: { tag: 'BUG' },
        },
        signUpDate: new Date('2022-01-01'),
      }

      const settings = await ctx.UserSettingsHelper.buildUserSettings(
        ctx.req,
        ctx.res,
        user
      )

      expect(settings.highlight).toEqual([{ tag: 'BUG', color: '#ff8c00' }])
    })
  })
})
