import { expect } from 'chai'
import { EditorState } from '@codemirror/state'
import {
  ProjectionItem,
  updatePosition,
} from '../../../../../frontend/js/features/source-editor/utils/tree-operations/projection'

class TestItem extends ProjectionItem {}

const itemAt = (
  from: number,
  to: number,
  line: number,
  toLine: number
): TestItem => Object.assign(new TestItem(), { from, to, line, toLine })

describe('updatePosition', function () {
  it('returns the same instance when positions and lines are unchanged', function () {
    const state = EditorState.create({ doc: 'first line\nsecond line' })
    const tr = state.update({ changes: { from: 0, to: 0, insert: '' } })
    const item = itemAt(11, 22, 2, 2)
    expect(updatePosition(item, tr)).to.equal(item)
  })

  it('refreshes both line and toLine after an upstream insert adds lines', function () {
    const state = EditorState.create({ doc: 'first line\nsecond line' })
    const tr = state.update({
      changes: { from: 0, to: 0, insert: 'top\nmiddle\n' },
    })
    // Item originally covered "second line" (lines 2..2) at offsets 11..22.
    const item = itemAt(11, 22, 2, 2)
    const updated = updatePosition(item, tr)
    expect(updated).to.not.equal(item)
    expect(updated.from).to.equal(22)
    expect(updated.to).to.equal(33)
    expect(updated.line).to.equal(4)
    expect(updated.toLine).to.equal(4)
  })

  it('refreshes line and toLine independently for multi-line items', function () {
    const state = EditorState.create({
      doc: 'a\nbb\nccc\ndddd\neeeee',
    })
    // Item covers "bb\nccc" at offsets 2..8, on lines 2..3.
    const item = itemAt(2, 8, 2, 3)
    const tr = state.update({
      changes: { from: 0, to: 0, insert: 'X\n' },
    })
    const updated = updatePosition(item, tr)
    expect(updated.from).to.equal(4)
    expect(updated.to).to.equal(10)
    expect(updated.line).to.equal(3)
    expect(updated.toLine).to.equal(4)
  })
})
