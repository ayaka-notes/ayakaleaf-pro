/**
 * Mendeley picker modal — regression test for the "empty on first open" bug:
 * the default library ("My Library", first entry) must load its items as
 * soon as the library list arrives, without the user switching to another
 * library and back.
 */
import React from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const { getJSONMock } = vi.hoisted(() => ({ getJSONMock: vi.fn() }))

vi.mock('@/infrastructure/fetch-json', () => ({
  getJSON: (url: string) => getJSONMock(url),
  postJSON: vi.fn(),
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))
vi.mock('@/shared/components/ol/ol-modal', () => ({
  OLModal: ({ show, children }: any) =>
    show ? <div data-testid="modal-root">{children}</div> : null,
  OLModalHeader: ({ children }: any) => <header>{children}</header>,
  OLModalTitle: ({ children }: any) => <h2>{children}</h2>,
  OLModalBody: ({ children }: any) => <div>{children}</div>,
  OLModalFooter: ({ children }: any) => <footer>{children}</footer>,
}))
vi.mock('@/shared/components/ol/ol-button', () => ({
  __esModule: true,
  default: ({ children, type, disabled }: any) => (
    <button type={type || 'button'} disabled={disabled} data-testid="btn">
      {children}
    </button>
  ),
}))
vi.mock('@/shared/components/ol/ol-form-control', () => ({
  __esModule: true,
  default: ({ value, onChange, placeholder, id }: any) => (
    <input id={id} value={value} placeholder={placeholder} onChange={onChange} data-testid="text" />
  ),
}))
vi.mock('@/shared/components/ol/ol-form-group', () => ({
  __esModule: true,
  default: ({ children }: any) => <div>{children}</div>,
}))
vi.mock('@/shared/components/ol/ol-form-label', () => ({
  __esModule: true,
  default: ({ children, htmlFor }: any) => <label htmlFor={htmlFor}>{children}</label>,
}))
vi.mock('@/shared/components/ol/ol-form-select', () => ({
  __esModule: true,
  default: ({ value, onChange, children, id }: any) => (
    <select id={id} value={value} onChange={onChange} data-testid="libselect">
      {children}
    </select>
  ),
}))
vi.mock('@/shared/components/ol/ol-form-checkbox', () => ({
  __esModule: true,
  default: ({ checked, onChange, label, 'aria-label': ariaLabel }: any) => (
    <label>
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        aria-label={ariaLabel}
        data-testid="check"
      />
      {label}
    </label>
  ),
}))
vi.mock('@/shared/components/notification', () => ({
  __esModule: true,
  default: ({ content }: any) => <div data-testid="notif">{content}</div>,
}))

import MendeleyPickerModal from '../../../frontend/js/components/mendeley-picker-modal'

const LIBS = [
  { id: 'user', kind: 'user', name: 'My Library' },
  { id: 'g1', kind: 'group', name: 'Group A' },
]
const ITEMS: any = {
  items: [
    { key: 'A1', title: 'Paper One', type: 'journalArticle', year: '2024', firstCreator: 'Doe, J.' },
    { key: 'A2', title: 'Paper Two', type: 'book', year: '2020', firstCreator: 'Roe, A.' },
  ],
  next: 'cursor2',
}

beforeEach(() => {
  getJSONMock.mockReset()
  getJSONMock.mockImplementation((url: string) =>
    Promise.resolve(url.includes('/picker/libraries') ? LIBS : ITEMS),
  )
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

afterEach(() => {
  document.body.innerHTML = ''
})

async function flush(times = 6) {
  for (let i = 0; i < times; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await Promise.resolve() })
  }
}

describe('MendeleyPickerModal initial load', () => {
  it('loads the default library (My Library) as soon as the list arrives — no manual switch needed', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(
        <MendeleyPickerModal show handleHide={() => {}} onInsert={() => {}} />,
      )
    })
    await flush()

    const urls = getJSONMock.mock.calls.map((c) => String(c[0]))
    expect(urls.some((u) => u.includes('/user/mendeley/picker/libraries'))).toBe(true)

    // THE regression: the initial documents request for My Library fires
    // automatically (libraryKind=user, no group id, no query).
    const initial = urls.find(
      (u) =>
        u.includes('/user/mendeley/picker/documents') &&
        u.includes('libraryKind=user') &&
        !u.includes('&library=') &&
        !u.includes('query=') &&
        !u.includes('cursor='),
    )
    expect(initial, `expected an automatic My Library load; got: ${urls.join(' | ')}`)
      .toBeTruthy()

    // and the items are actually rendered
    expect(container.textContent).toContain('Paper One')
    expect(container.textContent).toContain('Paper Two')

    root.unmount()
  })

  it('switching to a group loads that group (library id in the query)', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(
        <MendeleyPickerModal show handleHide={() => {}} onInsert={() => {}} />,
      )
    })
    await flush()

    const select = container.querySelector('[data-testid="libselect"]') as HTMLSelectElement
    expect(select).toBeTruthy()
    await act(async () => {
      select.value = '1'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await flush()

    const urls = getJSONMock.mock.calls.map((c) => String(c[0]))
    expect(
      urls.some((u) => u.includes('libraryKind=group') && u.includes('library=g1')),
    ).toBe(true)
    root.unmount()
  })

  it('reopening the modal re-loads the default library', async () => {
    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    const setProps = (show: boolean) =>
      act(async () => {
        root.render(
          <MendeleyPickerModal show={show} handleHide={() => {}} onInsert={() => {}} />,
        )
      })
    await setProps(true)
    await flush()
    const firstLoadCount = getJSONMock.mock.calls.filter(
      (c) => String(c[0]).includes('libraryKind=user'),
    ).length
    expect(firstLoadCount).toBe(1)

    await setProps(false)
    await setProps(true)
    await flush()
    const secondLoadCount = getJSONMock.mock.calls.filter(
      (c) => String(c[0]).includes('libraryKind=user'),
    ).length
    expect(secondLoadCount).toBe(2)
    root.unmount()
  })
})
