import { expect } from 'chai'
import { EditorState } from '@codemirror/state'
import { computeCommentOutline } from '../../../../../frontend/js/features/source-editor/extensions/comment-outline'
import type { HighlightTag } from '../../../../../types/user-settings'

const doc = `\\documentclass{article}
% TODO: fix the intro
\\begin{document}
%    TODO with leading spaces
Some text with the word TODO but no percent sign.
% FIXME broken figure
% BUG: crash on save
\\end{document}`

// line 2  % TODO: fix the intro
// line 4  %    TODO with leading spaces
// line 6  % FIXME broken figure
// line 7  % BUG: crash on save

const TAGS: HighlightTag[] = [
  { tag: 'TODO', color: '#ff8c00' },
  { tag: 'FIXME', color: '#e5484d' },
  { tag: 'BUG', color: '#8b5cf6' },
]

describe('computeCommentOutline', function () {
  function createDoc() {
    return EditorState.create({ doc }).doc
  }

  it('lists the matching comments with tag, line and text', function () {
    const entries = computeCommentOutline(createDoc(), TAGS)
    expect(entries.map(e => e.line)).to.deep.equal([2, 4, 6, 7])

    const intro = entries.find(e => e.line === 2)!
    expect(intro.tag).to.equal('TODO')
    expect(intro.color).to.equal('#ff8c00')
    expect(intro.text).to.equal('fix the intro')

    const leading = entries.find(e => e.line === 4)!
    expect(leading.text).to.equal('with leading spaces')

    const broken = entries.find(e => e.line === 6)!
    expect(broken.tag).to.equal('FIXME')
    expect(broken.text).to.equal('broken figure')

    const crash = entries.find(e => e.line === 7)!
    expect(crash.tag).to.equal('BUG')
    expect(crash.text).to.equal('crash on save')
  })

  it('ignores tags that are not in a comment', function () {
    const entries = computeCommentOutline(createDoc(), TAGS)
    // line 5 has the word TODO but no % comment
    expect(entries.map(e => e.line)).to.not.include(5)
  })

  it('is empty when there are no tags', function () {
    expect(computeCommentOutline(createDoc(), [])).to.deep.equal([])
  })
})
