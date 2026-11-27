import { expect } from 'chai'
import { render, screen, fireEvent } from '@testing-library/react'
import fetchMock from 'fetch-mock'
import HighlightForm from '@/features/highlight/highlight-form'
import type { HighlightTag } from '@ol-types/user-settings'

const INITIAL: HighlightTag[] = [
  { tag: 'TODO', color: '#ff8c00' },
  { tag: 'FIXME', color: '#e5484d' },
]

describe('HighlightForm', function () {
  let saveSettingsMock: typeof fetchMock

  beforeEach(function () {
    fetchMock.removeRoutes().clearHistory()
    saveSettingsMock = fetchMock.post(
      'express:/user/settings',
      { status: 200 },
      { delay: 0 }
    )
  })

  afterEach(function () {
    fetchMock.removeRoutes().clearHistory()
  })

  function tagInputValues() {
    const inputs = Array.from(
      document.querySelectorAll<HTMLInputElement>('input[placeholder="TODO"]')
    )
    return inputs.map(input => input.value)
  }

  it('renders the existing tags', function () {
    render(<HighlightForm initialTags={INITIAL} />)
    expect(tagInputValues()).to.deep.equal(['TODO', 'FIXME'])
  })

  it('adds a new tag and saves', function () {
    render(<HighlightForm initialTags={INITIAL} />)
    const newTagInput = screen.getByPlaceholderText('e.g. NOTE')
    fireEvent.change(newTagInput, { target: { value: 'NOTE' } })
    fireEvent.click(screen.getByText('Add tag'))
    expect(tagInputValues()).to.deep.equal(['TODO', 'FIXME', 'NOTE'])
    expect(
      saveSettingsMock.callHistory.called('/user/settings', {
        body: {
          highlight: [
            { tag: 'TODO', color: '#ff8c00' },
            { tag: 'FIXME', color: '#e5484d' },
            { tag: 'NOTE', color: '#ff8c00' },
          ],
        },
      })
    ).to.be.true
  })

  it('rejects a duplicate tag (case-insensitive)', function () {
    render(<HighlightForm initialTags={INITIAL} />)
    const newTagInput = screen.getByPlaceholderText('e.g. NOTE')
    fireEvent.change(newTagInput, { target: { value: 'todo' } })
    fireEvent.click(screen.getByText('Add tag'))
    expect(tagInputValues()).to.deep.equal(['TODO', 'FIXME'])
  })

  it('removes a tag and saves', function () {
    render(<HighlightForm initialTags={INITIAL} />)
    const removeButtons = screen.getAllByText('Remove')
    fireEvent.click(removeButtons[0])
    expect(tagInputValues()).to.deep.equal(['FIXME'])
    expect(
      saveSettingsMock.callHistory.called('/user/settings', {
        body: {
          highlight: [{ tag: 'FIXME', color: '#e5484d' }],
        },
      })
    ).to.be.true
  })

  it('saves a new colour for a tag', function () {
    render(<HighlightForm initialTags={INITIAL} />)
    const colorInput = screen.getByLabelText('Highlight color: TODO')
    fireEvent.change(colorInput, { target: { value: '#123456' } })
    expect(
      saveSettingsMock.callHistory.called('/user/settings', {
        body: {
          highlight: [
            { tag: 'TODO', color: '#123456' },
            { tag: 'FIXME', color: '#e5484d' },
          ],
        },
      })
    ).to.be.true
  })
})
