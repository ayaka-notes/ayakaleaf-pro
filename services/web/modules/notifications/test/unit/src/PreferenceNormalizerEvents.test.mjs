import { describe, expect, it } from 'vitest'
import {
  normalizeGlobalPreferences,
  normalizeGlobalEvents,
} from '../../../app/src/PreferenceNormalizer.mjs'

describe('PreferenceNormalizer — events', function () {
  it('defaults both events to enabled', () => {
    const normalized = normalizeGlobalPreferences({})
    expect(normalized.events).toEqual({ projectChanges: true, comments: true })
  })

  it('honours explicit event switches', () => {
    const normalized = normalizeGlobalPreferences({
      events: { projectChanges: false, comments: true },
    })
    expect(normalized.events).toEqual({ projectChanges: false, comments: true })
  })

  it('coerces non-boolean values', () => {
    expect(normalizeGlobalEvents({ comments: 'yes' }).comments).toBe(true)
    expect(normalizeGlobalEvents({ comments: 0 }).comments).toBe(false)
    expect(normalizeGlobalEvents({}).comments).toBe(true)
  })
})
