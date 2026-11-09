import { expect } from 'chai'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import {
  setTagHighlight,
  tagHighlight,
} from '../../../../../frontend/js/features/source-editor/extensions/tag-highlight'
import type { HighlightTag } from '../../../../../types/user-settings'

const doc = `\\documentclass{article}
% TODO: fix the intro
\\begin{document}
%    TODO with leading spaces
Some text with the word TODO but no percent sign.
% TODOIST is a longer word and must not match
% todo lowercase should match
50% TODO: a comment in the middle of the line
% FIXME and TODO on one line, FIXME listed first
% BUG: broken figure
\\end{document}`

// line 2  % TODO: fix the intro
// line 4  %    TODO with leading spaces
// line 5  (no comment)
// line 6  % TODOIST (longer word, must not match)
// line 7  % todo lowercase
// line 8  50% TODO: mid-line
// line 9  % FIXME and TODO on one line, FIXME listed first
// line 10 % BUG: broken figure

const TODO = { tag: 'TODO', color: '#ff8c00' }
const FIXME = { tag: 'FIXME', color: '#e5484d' }
const BUG = { tag: 'BUG', color: '#8b5cf6' }

describe('tagHighlight extension', function () {
  let view: EditorView
  let container: HTMLElement

  beforeEach(function () {
    container = document.createElement('div')
    document.body.appendChild(container)
  })

  afterEach(function () {
    view?.destroy()
    container?.remove()
  })

  function createView(tags: HighlightTag[] = [TODO]) {
    view = new EditorView({
      parent: container,
      state: EditorState.create({
        doc,
        extensions: [tagHighlight()],
      }),
    })
    // apply the tags, as use-codemirror-scope does after state creation
    view.dispatch(setTagHighlight(tags))
    return view
  }

  type Highlight = { line: number; style: string }

  function highlights(): Highlight[] {
    const sets = view.state.facet(EditorView.decorations) as any[]
    const result: Highlight[] = []
    for (const set of sets) {
      const cursor = set.iter(0)
      while (cursor.value) {
        const decoration = cursor.value
        const spec = decoration.spec || {}
        if (
          spec.className === 'cm-tag-highlight' ||
          spec.class === 'cm-tag-highlight'
        ) {
          result.push({
            line: view.state.doc.lineAt(cursor.from).number,
            style: spec.attributes?.style || '',
          })
        }
        cursor.next()
      }
    }
    return result.sort((a, b) => a.line - b.line)
  }

  it('highlights lines whose comment contains the tag', function () {
    createView()
    expect(highlights().map(h => h.line)).to.deep.equal([2, 4, 7, 8])
  })

  it('ignores whitespace between the % and the tag', function () {
    createView()
    // line 4 is "%    TODO with leading spaces" (only spaces between % and tag)
    expect(highlights().map(h => h.line)).to.include(4)
  })

  it('matches the tag case-insensitively', function () {
    createView()
    // line 7 is "% todo lowercase should match"
    expect(highlights().map(h => h.line)).to.include(7)
  })

  it('does not highlight lines without a % comment', function () {
    createView()
    expect(highlights().map(h => h.line)).to.not.include(5)
  })

  it('does not match the tag as a prefix of a longer word', function () {
    createView()
    // line 6 is "% TODOIST is a longer word"
    expect(highlights().map(h => h.line)).to.not.include(6)
  })

  it('highlights no lines when the tag list is empty', function () {
    createView([])
    expect(highlights()).to.deep.equal([])
  })

  it('applies the initial tags after state creation', function () {
    createView([TODO])
    expect(highlights().map(h => h.line)).to.deep.equal([2, 4, 7, 8])
  })

  it('applies each tag its own colour', function () {
    createView([TODO, FIXME, BUG])
    const byLine = Object.fromEntries(highlights().map(h => [h.line, h]))
    expect(byLine[2].style).to.include('#ff8c00')
    expect(byLine[9].style).to.include('#e5484d')
    expect(byLine[10].style).to.include('#8b5cf6')
  })

  it('uses the colour of the first matching tag in the list', function () {
    // line 9 contains both FIXME and TODO; FIXME is listed first
    createView([FIXME, TODO])
    const byLine = Object.fromEntries(highlights().map(h => [h.line, h]))
    expect(byLine[9].style).to.include('#e5484d')
    // line 2 only has TODO
    expect(byLine[2].style).to.include('#ff8c00')
  })

  it('updates the highlighted lines when the tags are changed', function () {
    createView([TODO])
    expect(highlights().map(h => h.line)).to.deep.equal([2, 4, 7, 8])
    view.dispatch(setTagHighlight([NOTE]))
    expect(highlights().map(h => h.line)).to.deep.equal([])
    view.dispatch(setTagHighlight([TODO]))
    expect(highlights().map(h => h.line)).to.deep.equal([2, 4, 7, 8])
  })
})

const NOTE = { tag: 'NOTE', color: '#3b82f6' }
