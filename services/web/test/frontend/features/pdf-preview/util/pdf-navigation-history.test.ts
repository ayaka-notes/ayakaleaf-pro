import { expect } from 'chai'
import sinon from 'sinon'
import {
  PdfNavigationHistory,
  PdfNavigationPosition,
} from '@/features/pdf-preview/util/pdf-navigation-history'

describe('PdfNavigationHistory', function () {
  const position = (page: number, top = 700): PdfNavigationPosition => ({
    page,
    offset: { left: 12, top },
  })
  let current: PdfNavigationPosition | undefined
  let history: PdfNavigationHistory
  let changed: sinon.SinonSpy
  let restore: sinon.SinonSpy

  // Model the guarded service: snapshot, apply the destination, then commit.
  function jump(destination: PdfNavigationPosition) {
    history.pushCurrentPosition()
    current = destination
    history.push()
  }

  beforeEach(function () {
    current = position(0)
    changed = sinon.spy()
    restore = sinon.spy((destination: PdfNavigationPosition) => {
      current = destination
    })
    history = new PdfNavigationHistory(() => current, restore, changed)
  })

  it('starts with both directions disabled and ignores boundary actions', function () {
    history.back()
    history.forward()
    expect(history.canGoBack).to.equal(false)
    expect(history.canGoForward).to.equal(false)
    expect(restore).not.to.have.been.called
    expect(changed).not.to.have.been.called
  })

  it('returns from a citation to the exact departure and forwards again', function () {
    const departure = position(5, 432)
    const bibliography = position(41, 210)
    current = departure
    jump(bibliography)
    expect(history.canGoBack).to.equal(true)
    expect(history.canGoForward).to.equal(false)
    history.back()
    expect(current).to.deep.equal(departure)
    expect(history.canGoBack).to.equal(false)
    expect(history.canGoForward).to.equal(true)
    history.forward()
    expect(current).to.deep.equal(bibliography)
    expect(history.canGoForward).to.equal(false)
  })

  it('supports multiple consecutive jumps in both directions', function () {
    jump(position(1))
    jump(position(2))
    jump(position(3))
    for (const page of [2, 1, 0]) {
      history.back()
      expect(current).to.deep.equal(position(page))
    }
    for (const page of [1, 2, 3]) {
      history.forward()
      expect(current).to.deep.equal(position(page))
    }
  })

  it('discards the forward branch after following a new internal link', function () {
    jump(position(1))
    jump(position(2))
    history.back()
    jump(position(3))
    expect(history.canGoForward).to.equal(false)
    history.back()
    expect(current).to.deep.equal(position(1))
    history.forward()
    expect(current).to.deep.equal(position(3))
  })

  it('records same-page destinations with distinct offsets', function () {
    jump(position(0, 120))
    history.back()
    expect(current).to.deep.equal(position(0, 700))
    history.forward()
    expect(current).to.deep.equal(position(0, 120))
  })

  it('uses the live departure after scrolling or SyncTeX', function () {
    jump(position(2))
    current = position(4, 321)
    expect(changed).to.have.been.calledOnce
    history.back()
    history.forward()
    expect(current).to.deep.equal(position(4, 321))
  })

  it('preserves forward history during ordinary position updates', function () {
    jump(position(1))
    history.back()
    current = position(0, 300)
    expect(history.canGoForward).to.equal(true)
    history.forward()
    history.back()
    expect(current).to.deep.equal(position(0, 300))
  })

  it('copies the coordinates instead of retaining a mutable snapshot', function () {
    const departure = current!
    history.pushCurrentPosition()
    departure.offset.top = 100
    current = position(2)
    history.push()
    history.back()
    expect(current).to.deep.equal(position(0, 700))
  })

  it('accepts PDFLinkService page destinations through pushPage', function () {
    history.pushCurrentPosition()
    current = position(2)
    history.pushPage()
    history.back()
    expect(current).to.deep.equal(position(0))
  })

  it('does not add history without a ready PDF position', function () {
    current = undefined
    history.pushCurrentPosition()
    history.push()
    history.pushPage()
    expect(history.canGoBack).to.equal(false)
    expect(changed).not.to.have.been.called
  })

  it('does not navigate while a PDF position is unavailable', function () {
    jump(position(1))
    current = undefined
    history.back()
    expect(history.canGoBack).to.equal(true)
    expect(restore).not.to.have.been.called
  })

  it('clears both stacks and pending coordinates on PDF replacement', function () {
    jump(position(1))
    jump(position(2))
    history.back()
    history.pushCurrentPosition()
    history.reset()
    history.push()
    history.back()
    history.forward()
    expect(history.canGoBack).to.equal(false)
    expect(history.canGoForward).to.equal(false)
    expect(restore).to.have.been.calledOnce
  })

  it('bounds the history to the most recent 100 departures', function () {
    for (let page = 1; page <= 105; page++) jump(position(page))
    for (let step = 0; step < 100; step++) history.back()
    expect(current).to.deep.equal(position(5))
    expect(history.canGoBack).to.equal(false)
    for (let step = 0; step < 100; step++) history.forward()
    expect(current).to.deep.equal(position(105))
    expect(history.canGoForward).to.equal(false)
  })

  it('leaves both stacks intact when restoring throws', function () {
    const throwingHistory = new PdfNavigationHistory(
      () => current,
      () => {
        throw new Error('restore failed')
      },
      changed
    )
    throwingHistory.pushCurrentPosition()
    current = position(1)
    throwingHistory.push()
    expect(() => throwingHistory.back()).to.throw('restore failed')
    expect(throwingHistory.canGoBack).to.equal(true)
    expect(throwingHistory.canGoForward).to.equal(false)
  })

  it('ignores unchanged or subpixel positions without clearing the forward stack', function () {
    jump(position(1))
    history.back()
    const count = changed.callCount
    jump(position(0, 700.1))
    expect(history.canGoBack).to.equal(false)
    expect(history.canGoForward).to.equal(true)
    expect(changed.callCount).to.equal(count)
  })
})
