import fs from 'node:fs/promises'
import Path from 'node:path'
import zlib from 'node:zlib'
import logger from '@overleaf/logger'

// SynctexAdapter — bridges tinymist's `output.synctex.gz` (standard SyncTeX
// 1.0, written by the unmerged tinymist `--synctex` branch — fingolfin/
// tinymist branch `synctex`, Max Horn's `feat(cli): add --synctex for PDF
// export`) into the `output.sourcemap.json` sidecar that TypstSourcemap.js
// consumes.
//
// Background: the stock `typst` CLI exposes no source mapping at all. tinymist
// computes the same data in-process (typst's `SourceMap` / glyph spans) and
// writes it as a SyncTeX file, which we adapt here:
//
//   synctex (per text run): tag -> file, line, baseline point (x, y from the
//                           page top), width, ascent, depth — in scaled
//                           points (SP_PER_PT per PostScript point)
//   sidecar (per location): span.file, span.byteOffset, page (0-based),
//                           x, y (bottom edge from the page bottom), w, h —
//                           in points
//
// Precision: the `--synctex` writer emits the glyph's byte offset into the
// source file as the third SyncTeX link field (the spec's optional `column`;
// for ASCII it equals the character column). We use it directly as
// `span.byteOffset`, so a cursor lands on the exact spot, not just the line.
// A record without the field falls back to the start of the recorded line,
// so hit-testing (page + x/y/w/h) is never affected.

// tinymist's SP_PER_PT (crates/tinymist-task/src/compute/synctex.rs):
// 65536 sp per TeX point, 72.27 TeX points per 72 PostScript points.
const SP_PER_PT = 65536.0 * (72.27 / 72.0)

// SyncTeX 1.0 record: <link>:<point>:<size> with link = tag,line[,byteoff],
// point = x,y (the baseline origin; y grows downward from the page top),
// size = Width,Height,Depth (height = ascent above the baseline,
// depth = descent below it).
//   text run: (tag,line,byteoff:x,y:width,ascent,depth)   (byteoff optional)
// Note: tinymist's writer emits the run record body on one line and the
// closing ')' on the next line ("(...\n)"), so the paren is optional here.
const RUN_RECORD_RE =
  /^\((\d+),(\d+)(?:,(\d+))?:(-?\d+),(-?\d+):(-?\d+),(-?\d+),(-?\d+)(\))?\s*$/
// Page record: [tag,line:x,y:width,height,depth — the page box's origin is
// (0, pageHeight) and its size carries the page dimensions.
const PAGE_RECORD_RE =
  /^\[(\d+),(\d+):(-?\d+),(-?\d+):(-?\d+),(-?\d+),(-?\d+)/

// parseSyncTex extracts { files, pages } from SyncTeX 1.0 text (the subset
// tinymist writes: header Input lines, {N…}N page blocks, one page record +
// run records per page). Everything else (glue/kern/math records, forms) is
// ignored.
function parseSyncTex(text) {
  const files = []
  const pages = []
  let current = null
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    let m
    if ((m = line.match(/^Input:(\d+):(.*)$/))) {
      files[Number(m[1]) - 1] = m[2]
      continue
    }
    if (line === 'Content:') continue
    if (line === 'Postamble:' || line.startsWith('Count:')) break
    if ((m = line.match(/^\{(\d+)\s*$/))) {
      current = { number: Number(m[1]), width: null, height: null, records: [] }
      pages.push(current)
      continue
    }
    if (!current) continue
    if ((m = line.match(PAGE_RECORD_RE))) {
      current.width = Number(m[5])
      current.height = Number(m[6])
      continue
    }
    if ((m = line.match(RUN_RECORD_RE))) {
      current.records.push({
        tag: Number(m[1]),
        line: Number(m[2]),
        offset: m[3] != null ? Number(m[3]) : null,
        x: Number(m[4]),
        y: Number(m[5]),
        width: Number(m[6]),
        ascent: Number(m[7]),
        depth: Number(m[8]),
      })
      continue
    }
    // ']', ')', '}N' and any other record type: not needed
  }
  return { files, pages }
}

// relativizePath maps a container-absolute source path (e.g.
// /compile/chap/intro.typ) onto the compile-root-relative form the consumer
// expects (chap/intro.typ). Falls back to the basename when the root prefix
// is not present (e.g. virtual files).
function relativizePath(p, containerRoot) {
  if (containerRoot && p.startsWith(containerRoot + '/')) {
    return p.slice(containerRoot.length + 1)
  }
  return Path.posix.basename(p)
}

// lineStartOffset returns the 0-based character offset of the start of the
// 1-based `line` in content; saturates to content.length when the line does
// not exist.
function lineStartOffset(content, line) {
  if (!Number.isFinite(line) || line < 1) return 0
  let offset = 0
  for (let n = 1; n < line; n++) {
    const nl = content.indexOf('\n', offset)
    if (nl === -1) return content.length
    offset = nl + 1
  }
  return offset
}

function round2(v) {
  return Math.round(v * 100) / 100
}

// toSidecar converts parsed SyncTeX data into the sidecar schema:
//
//   { typst, pages, pageSizes: [[w, h], …],
//     locations: [{ span: { file, byteOffset }, page, x, y, w, h }, …] }
//
// Coordinates: PDF user space (points, origin at the page's bottom-left,
// y up) — the basis TypstSourcemap.js and the frontend wire expect.
//   x  = run.x / K
//   y  = (pageH - run.y - run.depth) / K     (bottom edge, from page bottom)
//   w  = run.width / K
//   h  = (run.ascent + run.depth) / K
//
// readContent(fileRel) must return the file's text (UTF-8) or throw; it is
// only used to derive byteOffset from the line number.
async function toSidecar({ files, pages }, { readContent, containerRoot = '/compile' } = {}) {
  const pageSizes = []
  const locations = []
  const cache = new Map() // fileRel -> { content, starts }

  async function resolveOffset(fileRel, line) {
    let entry = cache.get(fileRel)
    if (!entry) {
      let content = null
      try {
        content = await readContent(fileRel)
      } catch (err) {
        if (err && err.code !== 'ENOENT') {
          logger.warn({ err, fileRel }, 'synctex adapter: cannot read source file')
        }
        content = null
      }
      entry = { content, starts: [] }
      cache.set(fileRel, entry)
    }
    if (entry.content == null) return 0 // file unreadable: degrade gracefully
    if (entry.starts[line] == null) {
      entry.starts[line] = lineStartOffset(entry.content, line)
    }
    return entry.starts[line]
  }

  for (const page of pages) {
    const pageW = page.width != null ? page.width / SP_PER_PT : null
    const pageH = page.height != null ? page.height / SP_PER_PT : null
    pageSizes.push([
      pageW != null ? round2(pageW) : 595.28,
      pageH != null ? round2(pageH) : 841.89,
    ])
    for (const r of page.records) {
      const file = relativizePath(files[r.tag - 1] ?? '', containerRoot)
      const byteOffset = r.offset != null ? r.offset : await resolveOffset(file, r.line)
      locations.push({
        span: { file, byteOffset },
        page: page.number - 1, // 0-based (consumer basis)
        x: round2(r.x / SP_PER_PT),
        y: pageH != null ? round2((pageH - r.y / SP_PER_PT - r.depth / SP_PER_PT)) : 0,
        w: round2(r.width / SP_PER_PT),
        h: round2((r.ascent + r.depth) / SP_PER_PT),
      })
    }
  }

  return {
    typst: '0.15.1+tinymist-synctex',
    pages: pageSizes.length,
    pageSizes,
    locations,
  }
}

// synctexToSidecar(dir) reads <dir>/output.synctex.gz (written by
// `tinymist compile --synctex`), converts it, and writes
// <dir>/output.sourcemap.json. ENOENT for the .gz is not an error (caller
// treats the sidecar as best-effort; the API degrades to 404).
async function synctexToSidecar(dir, opts = {}) {
  const gzPath = Path.join(dir, 'output.synctex.gz')
  const buf = await fs.readFile(gzPath)
  const text = zlib.gunzipSync(buf).toString('utf8')
  const sidecar = await toSidecar(parseSyncTex(text), {
    containerRoot: opts.containerRoot || '/compile',
    readContent: fileRel => fs.readFile(Path.join(dir, fileRel), 'utf8'),
  })
  await fs.writeFile(
    Path.join(dir, 'output.sourcemap.json'),
    JSON.stringify(sidecar)
  )
  return sidecar
}

export default {
  SP_PER_PT,
  parseSyncTex,
  relativizePath,
  lineStartOffset,
  toSidecar,
  synctexToSidecar,
}
