/**
 * Typst compile-log parser.
 *
 * Parses the clsi-typst `output.log` (the typst compiler's miette-style
 * diagnostics, captured verbatim by clsi-typst via
 * `typst compile main.typ output.pdf >> output.log 2>&1`) into `LogEntry[]`
 * so the PDF preview "Output Logs" panel + the click-to-source hook (which
 * reads `entry.file` / `entry.line` / `entry.column`) work for `.typ` docs.
 *
 * Block shape (one per diagnostic; blocks separated by blank lines):
 *
 *   error: <message>                          <- header: error|warning|note|info
 *     ┌─ main.typ:3:9                         <- location: file line:col (1-based)
 *     │
 *   3 │ #let x = (1 + 2                       <- snippet: raw source line (optional)
 *     │          ^                            <- caret (optional)
 *
 * A diagnostic has exactly one primary location; the leading
 * `typst 0.x.y (<hash>)` banner is a non-matching line and is ignored.
 */
import { ErrorLevel, LogEntry } from '@/features/pdf-preview/util/types'

// top-level diagnostic header (col 0, "note" counts as a warning)
const HEADER_RE = /^(error|warning|note|info):(.*)$/

// location line: "  ┌─ <file>:<line>:<col>"
const LOCATION_RE = /^\s*┌─(?:\s+(\S+))?:\s*(\d+):(\d+)/

export function parseTypstLog(
  raw: string | null | undefined
): LogEntry[] {
  const entries: LogEntry[] = []
  if (typeof raw !== 'string' || raw.length === 0) {
    return entries
  }

  const lines = raw.split('\n')
  let current: LogEntry | null = null
  let locationCount = 0

  const flush = () => {
    if (current) {
      entries.push(current)
      current = null
      locationCount = 0
    }
  }

  for (const line of lines) {
    const header = line.match(HEADER_RE)
    if (header) {
      flush()
      const kind = header[1]
      const level: ErrorLevel =
        kind === 'warning' || kind === 'note' ? 'warning' : 'error'
      current = {
        raw: line,
        level,
        key: String(entries.length),
        message: (header[2] || '').trim(),
      }
      continue
    }

    // location line attaches file/line/col to the open entry
    const loc = line.match(LOCATION_RE)
    if (loc && current) {
      const f = loc[1]
      const l = parseInt(loc[2], 10)
      const c = parseInt(loc[3], 10)
      if (locationCount === 0) {
        current.file = f
        current.line = l
        current.column = c
        locationCount = 1
      } else {
        ;(current as LogEntry & { location?: string }).location =
          (current as LogEntry & { location?: string }).location ?? '' +
          `\n${f || ''}:${l}:${c}`
      }
    }
  }
  flush()

  return entries.filter(
    e => (e.message !== undefined && e.message !== '') || e.file !== undefined
  )
}

/**
 * Split a parsed typst `output.log` into the {errors, warnings, typesetting}
 * groups the frontend `handleLogFiles` `accumulateResults` expects.
 * `typesetting` is unused for typst (clsi-typst emits no typesetting
 * diagnostics).
 */
export function parseTypstLogEntries(
  raw: string | null | undefined
): { errors: LogEntry[]; warnings: LogEntry[]; typesetting: LogEntry[] } {
  const all = parseTypstLog(raw)
  return {
    errors: all.filter(e => e.level === 'error'),
    warnings: all.filter(e => e.level === 'warning'),
    typesetting: [],
  }
}

export default parseTypstLog
