import fs from 'node:fs/promises'
import Path from 'node:path'
import OError from '@overleaf/o-error'

// TypstSourcemap — reader + coordinate math over the
// `output.sourcemap.json` sidecar (ported from the OlliTeX Go
// `clsitypst/sourcemap` package).
//
// The sidecar lives NEXT TO the compiled PDF (the same compile dir as
// output.pdf). It is produced by `tinymist compile --synctex` (which writes
// `output.synctex.gz`); SynctexAdapter converts that to this format after
// each compile (byteOffset at line-level precision).
// Schema (one object):
//
//   {
//     "typst":      "0.15.1+clsi",
//     "pages":      <int>,                                  // page count
//     "pageSizes":  [[w, h], ...],                          // per-page, user space
//     "locations":  [ {"span": {"file": string, "byteOffset": int64},
//                      "page": int,                          // 0-based
//                      "x","y","w","h": float } ]            // PDF user space
//   }
//
// Coordinates are PDF user space (points, origin at the page's bottom-left,
// y up) — the SAME basis the clsi synctex wire uses (the frontend
// highlights.ts flips v with pageHeight - v; it treats v as the bottom edge
// measured from the page bottom). No flip is applied: the sidecar values map
// 1:1 onto the clsi view-record h/v (h = left, v = bottom, w, h).
//
// Page basis: the wire "page" is 1-based (the frontend sends
// `position.page + 1`); the sidecar "page" is 0-based. The reader exposes
// both; the caller (CompileManager) bridges them.

class SourcemapError extends Error {}
class NotCompiledError extends SourcemapError {}
class NotFoundError extends SourcemapError {}

function parse(data) {
  let s
  try {
    s = JSON.parse(data)
  } catch (err) {
    throw new SourcemapError(`invalid sourcemap: ${err.message}`)
  }
  if (!s || typeof s !== 'object') {
    throw new SourcemapError('invalid sourcemap: not an object')
  }
  s.locations = Array.isArray(s.locations) ? s.locations : []
  s.pageSizes = Array.isArray(s.pageSizes) ? s.pageSizes : []
  return s
}

function pageSize(s, i) {
  if (i < 0 || i >= s.pageSizes.length || s.pageSizes[i].length < 2) {
    return null
  }
  return [s.pageSizes[i][0], s.pageSizes[i][1]]
}

// ---- byte/char conversion --------------------------------------------
// content is a JS string: indices are UTF-16 code units. The sidecar stores
// a UTF-8 BYTE offset (what tinymist / the typst fork emit), which only equals
// the char index for pure-ASCII content. These helpers bridge the two so the
// consumer is exact for multi-byte content (e.g. an em dash in a comment).
function utf8ByteLen(cp) {
  if (cp < 0x80) return 1
  if (cp < 0x800) return 2
  if (cp < 0x10000) return 3
  return 4
}

// 0-based char index -> UTF-8 byte offset.
function charToByte(content, charIndex) {
  if (charIndex <= 0) return 0
  if (charIndex >= content.length) {
    return Buffer.byteLength(content, 'utf8')
  }
  let byte = 0
  for (let i = 0; i < charIndex; i++) {
    const cp = content.codePointAt(i)
    byte += utf8ByteLen(cp)
    if (cp > 0xffff) i++ // a supplementary char occupies 2 code units
  }
  return byte
}

// UTF-8 byte offset -> 0-based char index (clamps to [0, len]).
function byteToChar(content, byteOffset) {
  if (byteOffset <= 0) return 0
  const total = Buffer.byteLength(content, 'utf8')
  if (byteOffset >= total) return content.length
  let byte = 0
  for (let i = 0; i < content.length; i++) {
    const cp = content.codePointAt(i)
    const blen = utf8ByteLen(cp)
    if (byte + blen > byteOffset) return i
    byte += blen
    if (cp > 0xffff) i++ // a supplementary char occupies 2 code units
  }
  return content.length
}

// offsetAt maps a 1-based (line, column) position to a 0-based UTF-8 byte
// offset in content (line 1 column 1 -> 0). Out-of-range positions saturate
// to the end of content (the reader is total; the caller has pre-validated
// the file exists). (line, column) are char-based, as in the editor.
function offsetAt(content, line, column) {
  let start = 0
  if (line >= 2) {
    // the (line-2)th newline (0-based) ends line (line-1)
    let found = -1
    for (let i = 0; i < content.length; i++) {
      if (content[i] === '\n') {
        found++
        if (found === line - 2) {
          start = i + 1
          break
        }
      }
    }
    if (found < line - 2) {
      return Buffer.byteLength(content, 'utf8') // past the last line
    }
  }
  // end of the line: next newline after start, else end of content.
  let end = content.length
  for (let i = start; i < content.length; i++) {
    if (content[i] === '\n') {
      end = i
      break
    }
  }
  if (column < 1) column = 1
  if (column > end - start) column = end - start
  return charToByte(content, start + column - 1)
}

// lineColAt maps a 0-based UTF-8 byte offset in content to a 1-based
// (line, column). Saturates: offset < 0 -> (1,1); offset >= byteLen -> (last,
// last).
function lineColAt(content, offset) {
  const total = Buffer.byteLength(content, 'utf8')
  const charIndex = Math.max(0, Math.min(offset, total))
  const idx = byteToChar(content, charIndex)
  let line = 1
  let column = 1
  for (let i = 0; i < idx; i++) {
    if (content[i] === '\n') {
      line++
      column = 1
    } else {
      column++
    }
  }
  return { line, column }
}

// nearestByOffset returns the location (span.file === file) whose byteOffset
// is nearest to offset (ties: the earlier one). null when there is no
// location for that file.
function nearestByOffset(locations, file, offset) {
  let best = -1
  for (let i = 0; i < locations.length; i++) {
    if (locations[i].span.file !== file) continue
    if (best === -1) {
      best = i
      continue
    }
    if (
      Math.abs(locations[i].span.byteOffset - offset) <
      Math.abs(locations[best].span.byteOffset - offset)
    ) {
      best = i
    }
  }
  return best === -1 ? null : locations[best]
}

// nearestByPoint returns the location on a 0-based page whose box contains
// (x, y) — or, if no box contains the point, whose center is nearest.
// Checking containment first avoids the "wide box center" problem where a
// click on the left edge of a wide heading maps to a different (nearer-center)
// location on the line above or below.
// Among multiple containing boxes (nested elements), the smallest (most
// specific) is preferred, so a click on an inner span maps to the span, not
// the enclosing paragraph.
function nearestByPoint(locations, page, x, y) {
  // Pass 1: containment (click is inside the box) — smallest containing box wins
  let contained = null
  for (let i = 0; i < locations.length; i++) {
    const loc = locations[i]
    if (loc.page !== page) continue
    if (
      x >= loc.x &&
      x <= loc.x + loc.w &&
      y >= loc.y &&
      y <= loc.y + loc.h
    ) {
      if (contained === null || loc.w * loc.h < contained.w * contained.h) {
        contained = loc
      }
    }
  }
  if (contained) return contained
  // Pass 2: nearest center (fallback)
  let best = -1
  const dist = loc => {
    const dx = x - (loc.x + loc.w / 2)
    const dy = y - (loc.y + loc.h / 2)
    return dx * dx + dy * dy
  }
  for (let i = 0; i < locations.length; i++) {
    if (locations[i].page !== page) continue
    if (best === -1) {
      best = i
      continue
    }
    if (dist(locations[i]) < dist(locations[best])) {
      best = i
    }
  }
  return best === -1 ? null : locations[best]
}

// viewRecord: sidecar box -> clsi view record (flat map, the synctex
// "Output:" field set: Page->page, h->h, v->v, W->width, H->height).
// page is 1-based on the wire.
function viewRecord(loc) {
  return {
    page: loc.page + 1,
    h: loc.x,
    v: loc.y,
    width: loc.w,
    height: loc.h,
  }
}

/**
 * loadSidecar (plan error arms, ordered):
 *  1. output.pdf missing in the resolved dir -> NotCompiledError (405)
 *  2. output.sourcemap.json missing there    -> NotFoundError "sourcemap
 *     not available" (404)
 *  3. malformed sidecar                      -> SourcemapError (500)
 */
async function loadSidecar(dir, projectId) {
  let fi
  try {
    fi = await fs.stat(Path.join(dir, 'output.pdf'))
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new NotCompiledError(`project not compiled: ${projectId}`)
    }
    throw OError.tag(err, 'error statting output.pdf', { dir, projectId })
  }
  if (!fi.isFile()) {
    throw new NotCompiledError(`project not compiled: ${projectId}`)
  }
  let data
  try {
    data = await fs.readFile(Path.join(dir, 'output.sourcemap.json'))
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new NotFoundError('sourcemap not available')
    }
    throw err
  }
  return parse(data.toString('utf8'))
}

export default {
  parse,
  pageSize,
  offsetAt,
  lineColAt,
  nearestByOffset,
  nearestByPoint,
  viewRecord,
  loadSidecar,
  errors: {
    SourcemapError,
    NotCompiledError,
    NotFoundError,
  },
}
