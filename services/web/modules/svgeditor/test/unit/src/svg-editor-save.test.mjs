import { describe, it, expect, vi } from 'vitest'
import { saveEditedSvg } from '../../../frontend/js/util/svg-editor-save.ts'

const t = (key, options) =>
  options
    ? `${key}:${Object.values(options).join(',')}`
    : key

function makeFetch({ uploadStatus = 200, uploadBody = { entity_id: 'new-file-id', hash: 'new-hash-1' } } = {}) {
  const calls = []
  const fetchImpl = async (url, opts = {}) => {
    calls.push({ url, opts })
    return {
      ok: uploadStatus < 400,
      status: uploadStatus,
      clone: () => ({
        json: async () =>
          typeof uploadBody === 'string' ? JSON.parse(uploadBody) : uploadBody,
      }),
    }
  }
  return { fetchImpl, calls }
}

describe('saveEditedSvg', function () {
  it('uploads the serialised SVG under the same name into the source folder', async function () {
    const { fetchImpl, calls } = makeFetch()
    const getSvg = vi
      .fn()
      .mockReturnValue(
        '\n  <?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"></svg>\n'
      )

    const result = await saveEditedSvg({
      projectId: 'proj-1',
      file: { name: 'figure.svg' },
      folderId: 'folder-42',
      csrfToken: 'tok',
      fetchImpl,
      getSvg,
      t,
    })

    expect(result).toEqual({
      ok: true,
      uploadedId: 'new-file-id',
      uploadedHash: 'new-hash-1',
    })
    expect(getSvg).toHaveBeenCalled()

    const upload = calls.find(c => c.url.includes('/upload'))
    expect(upload.url).toBe('/project/proj-1/upload?folder_id=folder-42')
    expect(upload.opts.method).toBe('POST')
    expect(upload.opts.headers['X-CSRF-TOKEN']).toBe('tok')

    const formData = upload.opts.body
    expect(formData.get('name')).toBe('figure.svg')
    const uploaded = formData.get('qqfile')
    expect(uploaded.name).toBe('figure.svg')
    expect(uploaded.type).toBe('image/svg+xml')
    // Trimmed serialised canvas text
    expect(await uploaded.text()).toBe(
      '<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg"></svg>'
    )
  })

  it('accepts non-JSON upload responses (upload still succeeded)', async function () {
    const { fetchImpl } = makeFetch({ uploadBody: 'not-json' })
    const result = await saveEditedSvg({
      projectId: 'proj-1',
      file: { name: 'diagram.svg' },
      folderId: '',
      fetchImpl,
      getSvg: () => '<svg></svg>',
      t,
    })
    expect(result).toEqual({
      ok: true,
      uploadedId: null,
      uploadedHash: null,
    })
  })

  it('fails cleanly when the upload is rejected', async function () {
    const { fetchImpl } = makeFetch({ uploadStatus: 500 })
    const result = await saveEditedSvg({
      projectId: 'proj-1',
      file: { name: 'figure.svg' },
      folderId: 'folder-42',
      fetchImpl,
      getSvg: () => '<svg></svg>',
      t,
    })
    expect(result.ok).toBe(false)
    expect(result.error).toBe('svg_edit_upload_failed:500')
  })

  it('refuses to save non-SVG file names', async function () {
    const { fetchImpl, calls } = makeFetch()
    const result = await saveEditedSvg({
      projectId: 'proj-1',
      file: { name: 'photo.png' },
      folderId: 'folder-42',
      fetchImpl,
      getSvg: () => '<svg></svg>',
      t,
    })
    expect(result.ok).toBe(false)
    expect(calls).toHaveLength(0)
  })

  it('refuses to save an empty canvas', async function () {
    const { fetchImpl, calls } = makeFetch()
    const result = await saveEditedSvg({
      projectId: 'proj-1',
      file: { name: 'figure.svg' },
      folderId: 'folder-42',
      fetchImpl,
      getSvg: () => '   ',
      t,
    })
    expect(result.ok).toBe(false)
    expect(calls).toHaveLength(0)
  })
})
