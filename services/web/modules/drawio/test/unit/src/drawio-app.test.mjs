import { describe, expect, it } from 'vitest'

import {
  BLOCKED_FILE_MENU_LABELS,
  isBlockedFileMenuLabel,
  normalizeMenuLabel,
} from '../../../frontend/js/util/drawio-app.ts'

/**
 * Host-constraint label logic (owner 2026-10-13): the File menu items that
 * contradict "this is the editor for the file this was opened for" must be
 * blocked; "Save" must NOT be (it is re-routed to the Overleaf sync
 * flush). The blocklist mirrors the labels of the vendored app's File
 * menu (see the user's 2026-10-13 menu capture).
 */

describe('normalizeMenuLabel', () => {
  it('strips ellipses (ascii and unicode), lowercases, trims', () => {
    expect(normalizeMenuLabel('Save as...')).toBe('save as')
    expect(normalizeMenuLabel('Save as…')).toBe('save as')
    expect(normalizeMenuLabel('  Make a Copy...  ')).toBe('make a copy')
    expect(normalizeMenuLabel('Share...')).toBe('share')
    expect(normalizeMenuLabel('Publish')).toBe('publish')
  })

  it('keeps plain labels', () => {
    expect(normalizeMenuLabel('Save')).toBe('save')
    expect(normalizeMenuLabel('Embed')).toBe('embed')
  })
})

describe('isBlockedFileMenuLabel — owner blocklist (2026-10-13)', () => {
  const blockedByOwner = [
    'New...',
    'New',
    'Open from',
    'Open Recent',
    'Save as...',
    'Share...',
    'Share',
    'Rename...',
    'Make a Copy...',
    'Import from',
    'Export as',
    'Embed',
    'Publish',
    'New Library',
    'Open Library from',
    'Properties...',
    'Page Setup...',
    'Print...',
    'Close',
  ]

  it.each(blockedByOwner)('blocks "%s"', label => {
    expect(isBlockedFileMenuLabel(label)).toBe(true)
  })

  it('does NOT block Save (re-routed to the Overleaf sync flush)', () => {
    expect(isBlockedFileMenuLabel('Save')).toBe(false)
    expect(isBlockedFileMenuLabel('Save...')).toBe(false)
  })

  it('does not block empty or label-less rows', () => {
    expect(isBlockedFileMenuLabel('')).toBe(false)
    expect(isBlockedFileMenuLabel('   ')).toBe(false)
    expect(isBlockedFileMenuLabel('...')).toBe(false)
  })

  it('blocklist is a set (no duplicate normalized labels)', () => {
    const labels = Array.from(BLOCKED_FILE_MENU_LABELS)
    expect(new Set(labels).size).toBe(labels.length)
    // nothing in the set should be the save action itself
    expect(labels).not.toContain('save')
  })
})
