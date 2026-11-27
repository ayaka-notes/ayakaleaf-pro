import { describe, expect, it } from 'vitest'
import { resolveProjectPath } from '../../../app/src/analyzer/resource-resolver.mjs'

describe('project inspection resource resolver', function () {
  it('resolves relative paths and inferred extensions', function () {
    expect(
      resolveProjectPath({
        target: 'figures/result',
        sourcePath: 'chapters/results.tex',
        availablePaths: new Set(['chapters/figures/result.png']),
        extensions: ['.pdf', '.png'],
      })
    ).toMatchObject({
      status: 'resolved',
      path: 'chapters/figures/result.png',
    })
  })

  it('does not append an extension when the target already has one', function () {
    expect(
      resolveProjectPath({
        target: 'figure.png',
        sourcePath: 'main.tex',
        availablePaths: new Set(['figure.png.pdf']),
        extensions: ['.pdf'],
      }).status
    ).toBe('missing')
  })

  it('does not resolve paths outside the project', function () {
    expect(
      resolveProjectPath({
        target: '../secret',
        sourcePath: 'main.tex',
        availablePaths: new Set(['secret.tex']),
        extensions: ['.tex'],
      }).status
    ).toBe('missing')
  })
})
