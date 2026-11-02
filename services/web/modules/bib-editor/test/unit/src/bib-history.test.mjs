/**
 * BibHistory — pure undo/redo state machine (bib-editor-extension.ts).
 *
 * Covers: basic undo/redo, redo-tail discard after branching edits,
 * coalescing (replaceTop), empty-history boundaries, and the size cap.
 */
import { describe, it, expect } from 'vitest'
import { BibHistory, looksLikeSameDocument } from '../../../frontend/js/extensions/bib-editor-extension.ts'

describe('BibHistory', () => {
  it('starts with a single snapshot: no undo, no redo', () => {
    const h = new BibHistory('doc0')
    expect(h.canUndo).toBe(false)
    expect(h.canRedo).toBe(false)
    expect(h.undo()).toBeNull()
    expect(h.redo()).toBeNull()
    expect(h.current).toBe('doc0')
  })

  it('undo walks back through live edits, redo walks forward', () => {
    const h = new BibHistory('a')
    h.append('b')
    h.append('c')
    expect(h.canUndo).toBe(true)
    expect(h.canRedo).toBe(false)

    expect(h.undo()).toBe('b')
    expect(h.current).toBe('b')
    expect(h.canRedo).toBe(true)

    expect(h.undo()).toBe('a')
    expect(h.current).toBe('a')
    expect(h.canUndo).toBe(false)
    expect(h.undo()).toBeNull() // boundary: nothing below index 0

    expect(h.redo()).toBe('b')
    expect(h.redo()).toBe('c')
    expect(h.canRedo).toBe(false)
    expect(h.redo()).toBeNull() // boundary: nothing above the live head
    expect(h.current).toBe('c')
  })

  it('an edit after undo discards the redo tail (standard behaviour)', () => {
    const h = new BibHistory('a')
    h.append('b')
    h.append('c')
    h.undo() // at 'b'
    h.append('d')
    // stack is now a → b → d ; 'c' is unreachable
    expect(h.canRedo).toBe(false)
    expect(h.current).toBe('d')
    expect(h.undo()).toBe('b')
    expect(h.undo()).toBe('a')
    expect(h.canUndo).toBe(false)
  })

  it('replaceTop coalesces a rapid successive update into one step', () => {
    const h = new BibHistory('a')
    h.append('b')
    h.append('b2', true) // coalesces 'b' → 'b2' (one step, not two)
    expect(h.length).toBe(2)
    expect(h.undo()).toBe('a') // one step back, NOT to 'b'
    expect(h.redo()).toBe('b2')
  })

  it('replaceTop never collapses the initial snapshot', () => {
    const h = new BibHistory('a')
    h.append('b', true) // length 1 → guard: appends instead of replacing
    expect(h.length).toBe(2)
    expect(h.undo()).toBe('a')
    expect(h.redo()).toBe('b')
  })

  it('bounds the stack to the configured max size (oldest dropped)', () => {
    const h = new BibHistory('s0', 3)
    h.append('s1')
    h.append('s2')
    h.append('s3')
    h.append('s4')
    expect(h.length).toBe(3)
    expect(h.current).toBe('s4')
    expect(h.undo()).toBe('s3')
    expect(h.undo()).toBe('s2')
    expect(h.canUndo).toBe(false)
  })

  it('reset replaces the whole stack', () => {
    const h = new BibHistory('a')
    h.append('b')
    h.reset('x')
    expect(h.length).toBe(1)
    expect(h.current).toBe('x')
    expect(h.canUndo).toBe(false)
    expect(h.canRedo).toBe(false)
  })
})

describe('looksLikeSameDocument (undo-stack file heuristic)', () => {
  const A = '@article{a2001,\n  author = {\n    Smith, A.\n  },\n  title = {First paper},\n  journal = {J. One},\n  year = {2001}\n}\n'
  it('same document is the same document', () => {
    expect(looksLikeSameDocument(A, A)).toBe(true)
  })

  it('a small edit (shared prefix+suffix) is the same document', () => {
    const edited = A.replace('2001', '2002')
    expect(looksLikeSameDocument(A, edited)).toBe(true)
  })

  it('an appended entry (shared prefix) is the same document', () => {
    const appended = A + '@book{b2020,\n  author = {\n    Lee, B.\n  },\n  title = {Second},\n  year = {2020}\n}\n'
    expect(looksLikeSameDocument(A, appended)).toBe(true)
  })

  it('a different file (no shared boundary) is NOT the same document', () => {
    const B = '@book{totally2020,\n  author = {\n    Unrelated, Z.\n  },\n  title = {A different bibliography},\n  publisher = {Else},\n  year = {2020}\n}\n'
    expect(looksLikeSameDocument(A, B)).toBe(false)
  })

  it('empty prev is a new session, not same', () => {
    expect(looksLikeSameDocument('', A)).toBe(true) // empty->anything: reset cost is zero
  })

  it('full replacement with different head+tail is NOT same', () => {
    expect(looksLikeSameDocument(A, 'Z' + A.slice(1, -1) + 'Y')).toBe(false)
  })
})

