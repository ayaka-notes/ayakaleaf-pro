import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import path from 'node:path'

const Path = path

const modulePath = path.join(
  import.meta.dirname,
  '../../../app/js/TypstRunner'
)

describe('TypstRunner', () => {
  beforeEach(async () => {
    vi.doMock('@overleaf/logger', () => ({
      default: {
        debug: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
    }))
    vi.doMock('../../../app/js/CommandRunner', () => ({
      default: {
        run: vi.fn(() => 1234),
        kill: vi.fn((id, cb) => cb(null)),
        promises: {
          run: vi.fn(),
          kill: vi.fn(),
        },
      },
    }))
  })
  afterEach(() => {
    vi.resetModules()
  })

  it('builds the typst compile command (exit 0 is deliberate)', async () => {
    const { buildTypstCompileCommand } = (
      await import(modulePath)
    ).default
    const cmd = buildTypstCompileCommand('main.typ')
    expect(cmd[0]).toBe('sh')
    expect(cmd[1]).toBe('-c')
    expect(cmd[2]).toContain('typst compile "$1" "$2"')
    expect(cmd[2]).toContain('exit 0')
    expect(cmd).toContain(Path.join('$COMPILE_DIR', 'main.typ'))
    expect(cmd).toContain('output.pdf')
    expect(cmd).toContain('output.log')
  })

  it('isRunning reflects the process table', async () => {
    const TR = (await import(modulePath)).default
    expect(TR.isRunning('p1')).toBe(false)
  })
})
