import { describe, it, expect } from 'vitest'
import {
  fileExtension,
  isSvgFile,
  looksLikeEditorLoaded,
  isDirty,
  findParentFolderId,
  findFileRefById,
} from '../../../frontend/js/util/svg-editor-utils.ts'

describe('fileExtension / isSvgFile', function () {
  it('detects .svg in any case', function () {
    expect(fileExtension('figure.svg')).toBe('svg')
    expect(fileExtension('FIGURE.SVG')).toBe('svg')
    expect(isSvgFile('figure.svg')).toBe(true)
    expect(isSvgFile('FIGURE.SVG')).toBe(true)
  })

  it('rejects other file types', function () {
    expect(isSvgFile('photo.png')).toBe(false)
    expect(isSvgFile('notes.txt')).toBe(false)
    expect(isSvgFile('archive.svgz')).toBe(false)
  })

  it('handles names without an extension', function () {
    expect(fileExtension('README')).toBeNull()
    expect(fileExtension('.hidden')).toBeNull()
    expect(fileExtension('a.b.')).toBeNull()
    expect(isSvgFile('README')).toBe(false)
    expect(isSvgFile('')).toBe(false)
  })
})

describe('looksLikeEditorLoaded', function () {
  it('is false for a null document or an empty document', function () {
    expect(looksLikeEditorLoaded(null)).toBe(false)
    expect(
      looksLikeEditorLoaded({
        querySelector: () => null,
      })
    ).toBe(false)
  })

  it('is true when the SVG-Edit left toolbar is present', function () {
    const fakeEl = { tagName: 'se-button' }
    expect(
      looksLikeEditorLoaded({
        querySelector: sel =>
          sel === '#tools_left, .svg-editor-container' ? fakeEl : null,
      })
    ).toBe(true)
  })

  it('is true when the app container class is present', function () {
    const fakeEl = { className: 'svg-editor-container' }
    expect(
      looksLikeEditorLoaded({
        querySelector: sel =>
          sel === '#tools_left, .svg-editor-container' ? fakeEl : null,
      })
    ).toBe(true)
  })

  it('swallows query failures', function () {
    expect(
      looksLikeEditorLoaded({
        querySelector: () => {
          throw new Error('detached document')
        },
      })
    ).toBe(false)
  })
})

describe('isDirty', function () {
  it('is false for identical serialisations', function () {
    expect(isDirty('<svg></svg>', '<svg></svg>')).toBe(false)
  })

  it('is false when only whitespace runs differ', function () {
    // Whitespace RUNS collapse; positions matter.
    expect(
      isDirty(
        '<svg><rect width="10   height="20"></rect></svg>',
        '<svg><rect width="10\n     height="20"></rect></svg>'
      )
    ).toBe(false)
  })

  it('is true for real content changes', function () {
    expect(
      isDirty(
        '<svg><rect></rect></svg>',
        '<svg><rect width="5"></rect></svg>'
      )
    ).toBe(true)
  })

  it('handles null/undefined inputs', function () {
    // Unknown baseline (editor never loaded) is treated as "not dirty":
    // the load-failure path owns that state, not the close guard.
    expect(isDirty(undefined, undefined)).toBe(false)
    expect(isDirty('', undefined)).toBe(false)
    expect(isDirty('<svg></svg>', '')).toBe(true)
    expect(isDirty('  ', undefined)).toBe(false)
  })
})

describe('findParentFolderId / findFileRefById', function () {
  const tree = {
    _id: 'root',
    fileRefs: [{ _id: 'root-file', name: 'main.tex' }],
    folders: [
      {
        _id: 'folder-1',
        fileRefs: [{ _id: 'fig-1', name: 'figure.svg' }],
        folders: [
          {
            _id: 'folder-2',
            fileRefs: [{ _id: 'fig-2', name: 'nested.svg' }],
            folders: [],
          },
        ],
      },
    ],
  }

  it('finds the parent folder of nested files', function () {
    expect(findParentFolderId(tree, 'fig-1')).toBe('folder-1')
    expect(findParentFolderId(tree, 'fig-2')).toBe('folder-2')
    expect(findParentFolderId(tree, 'root-file')).toBe('root')
  })

  it('returns null for unknown files', function () {
    expect(findParentFolderId(tree, 'nope')).toBeNull()
  })

  it('finds file refs by id', function () {
    expect(findFileRefById(tree, 'fig-1').name).toBe('figure.svg')
    expect(findFileRefById(tree, 'nope')).toBeNull()
  })
})
