import { describe, expect, it } from 'vitest'
import {
  normalizeGlobalPreferences,
  normalizeGlobalEvents,
  GLOBAL_EVENT_KEYS,
} from '../../../app/src/PreferenceNormalizer.mjs'
import { allEventKeys } from '../../../app/src/NotificationEvents.mjs'

describe('PreferenceNormalizer — events', function () {
  it('defaults every registered event to enabled', () => {
    const normalized = normalizeGlobalPreferences({})
    for (const key of GLOBAL_EVENT_KEYS) {
      expect(normalized.events[key]).toBe(true)
    }
  })

  it('normalizes exactly the registry keys', () => {
    const normalized = normalizeGlobalPreferences({})
    expect(Object.keys(normalized.events).sort()).toEqual(
      [...allEventKeys()].sort()
    )
  })

  it('honours explicit event switches', () => {
    const normalized = normalizeGlobalPreferences({
      events: { projectChanges: false, comments: true, newLogin: false },
    })
    expect(normalized.events.projectChanges).toBe(false)
    expect(normalized.events.comments).toBe(true)
    expect(normalized.events.newLogin).toBe(false)
    // untouched keys stay on
    expect(normalized.events.projectExpiring).toBe(true)
  })

  it('coerces non-boolean values', () => {
    expect(normalizeGlobalEvents({ comments: 'yes' }).comments).toBe(true)
    expect(normalizeGlobalEvents({ comments: 0 }).comments).toBe(false)
    expect(normalizeGlobalEvents({}).comments).toBe(true)
  })
})
