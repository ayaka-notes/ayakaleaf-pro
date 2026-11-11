import { expect } from 'chai'
import { insertCommentsIntoOutline } from '../../../../../frontend/js/features/source-editor/utils/tree-operations/outline-comments'
import type { Outline } from '../../../../../frontend/js/features/source-editor/utils/tree-operations/outline'

//
// Introduction            (line 1)
//   ...
// Examples                (line 20)
//   Sub A                 (line 25)
//   ...
//   Sub B                 (line 40)
//   ...
//
const outline: Outline[] = [
  { line: 1, title: 'Introduction', level: 4 },
  {
    line: 20,
    title: 'Examples',
    level: 4,
    children: [
      { line: 25, title: 'Sub A', level: 5 },
      { line: 40, title: 'Sub B', level: 5 },
    ],
  },
]

const TODO = { tag: 'TODO', color: '#ff8c00', text: 'fix the intro' }
const FIXME = { tag: 'FIXME', color: '#e5484d', text: 'broken figure' }

function commentChildren(item: Outline) {
  return (item.children || []).filter(child => child.comment)
}

describe('insertCommentsIntoOutline', function () {
  it('returns the same outline when there are no comments', function () {
    expect(insertCommentsIntoOutline(outline, [])).to.equal(outline)
  })

  it('places a comment under the section that contains its line', function () {
    const result = insertCommentsIntoOutline(outline, [
      { line: 5, ...TODO },
    ])
    // Introduction is the first item; the comment should be its child
    expect(commentChildren(result[0])).to.have.length(1)
    const introComment = result[0].children![0]!
    expect(introComment.comment!.tag).to.equal('TODO')
    expect(introComment.comment!.text).to.equal('fix the intro')
    expect(introComment.comment!.color).to.equal('#ff8c00')
    // the section title itself is preserved
    expect(result[0].title).to.equal('Introduction')
  })

  it('places a comment under the deepest (sub)section containing its line', function () {
    const result = insertCommentsIntoOutline(outline, [
      { line: 30, ...FIXME }, // inside Sub A (25..40)
    ])
    const examples = result[1]
    expect(commentChildren(examples)).to.have.length(0)
    const subA = examples.children!.find(c => c.title === 'Sub A')!
    expect(commentChildren(subA)).to.have.length(1)
    expect(subA.children![0]!.comment!.tag).to.equal('FIXME')
  })

  it('places a comment after the last subsection heading under that subsection', function () {
    // line 45 is after Sub B's heading (line 40), so it belongs to Sub B
    // (the innermost section whose range contains line 45)
    const result = insertCommentsIntoOutline(outline, [
      { line: 45, ...TODO },
    ])
    const examples = result[1]
    expect(commentChildren(examples)).to.have.length(0)
    const subB = examples.children!.find(c => c.title === 'Sub B')!
    const comments = commentChildren(subB)
    expect(comments).to.have.length(1)
    expect(comments[0]!.comment!.tag).to.equal('TODO')
  })

  it('places a comment before the first section at the top level', function () {
    const result = insertCommentsIntoOutline(outline, [
      { line: 0, ...TODO },
    ])
    expect(result).to.have.length(3) // Introduction, Examples, + comment
    expect(result[2].comment).to.not.equal(undefined)
    expect(result[2].comment!.tag).to.equal('TODO')
  })

  it('does not mutate the input outline', function () {
    const before = JSON.stringify(outline)
    insertCommentsIntoOutline(outline, [{ line: 5, ...TODO }])
    expect(JSON.stringify(outline)).to.equal(before)
  })

  it('inserts multiple comments in line order', function () {
    const result = insertCommentsIntoOutline(outline, [
      { line: 30, ...FIXME }, // Sub A
      { line: 5, ...TODO }, // Introduction
    ])
    expect(commentChildren(result[0])).to.have.length(1) // TODO in Introduction
    const subA = result[1].children!.find(c => c.title === 'Sub A')!
    expect(commentChildren(subA)).to.have.length(1) // FIXME in Sub A
  })
})
