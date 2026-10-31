/**
 * draw.io embed protocol (AK-11, owner 2026-10-08).
 *
 * Pure helpers for the bridge between this visual editor (host) and the
 * vendored draw.io app (iframe — public/static/drawio/PROVENANCE.txt).
 * Same discipline as the tikz protocol (tikz-protocol.ts): pure, DOM-free
 * helpers so the unit tests run without a browser.
 *
 * DIVISION OF LABOR — the hard part (raw-deflate/base64 of the graph XML)
 * is delegated to the APP (same-origin iframe, so we may call its JS
 * directly):
 *
 *   hash push   : iframe.Graph.compress(xml)  → "#R" + <base64>
 *   hash decode : iframe.Graph.decompress(<base64>)  → xml
 *
 * (both verified to exist in the vendored app.min.js; the app's pako is
 * what produces/consumes the bytes, so the round-trip is exact by
 * construction — no host-side codec, no bit-compatibility risk).
 *
 * The `.drawio` FILE CONVENTION in this instance (what
 * create-drawio-file.tsx writes and what parseDrawioFile reads):
 *
 *   <mxfile host="ollitex" agent="OlliTeX" version="1">
 *     <diagram id="p1" name="Page-1">
 *       <mxGraphModel ...>...</mxGraphModel>      ← classic inline shape
 *     </diagram>
 *   </mxfile>
 *
 * (the classic .drawio layout draw.io has always read; the newer
 * compressed-`<diagram>` body is also parsed, see parseDrawioFile.)
 */

const MXFILE_RE = /<mxfile\b[\s\S]*<\/mxfile>/i

function htmlUnescape(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function htmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Extract the graph (mxGraphModel) XML from a .drawio document. Handles
 * BOTH the classic inline body and the newer compressed body (draw.io
 * 25.x: the `<diagram>` contains the base64 deflate payload — the caller
 * decodes it through the app's Graph.decompress when that is the case).
 *
 * Returns
 *   { form: 'inline', xml }            — ready to hand to Graph.compress
 *   { form: 'compressed', payload }    — base64 payload for Graph.decompress
 * or null when the input is not a .drawio document.
 */
export function parseDrawioFile(text: string):
  | { form: 'inline'; xml: string }
  | { form: 'compressed'; payload: string }
  | null {
  if (!text || !text.trim()) return null

  // Bare graph model (no <mxfile> wrapper) — accept it as inline.
  if (/<mxGraphModel[\s>]/i.test(text) && !/<mxfile[\s>]/i.test(text)) {
    const m = text.match(/<mxGraphModel[\s>][\s\S]*<\/mxGraphModel>/i)
    return { form: 'inline', xml: m ? m[0] : text }
  }

  if (!MXFILE_RE.test(text)) return null

  const dm = text.match(/<diagram\b[^>]*>([\s\S]*?)<\/diagram>/i)
  if (!dm) return null

  let body = htmlUnescape(dm[1].trim())
  if (!body) return null

  if (/<mxGraphModel[\s>]/i.test(body)) {
    const m = body.match(/<mxGraphModel[\s>][\s\S]*<\/mxGraphModel>/i)
    return { form: 'inline', xml: m ? m[0] : body }
  }

  // Newer draw.io: the diagram body IS the compressed payload
  // (base64 without the R prefix).
  if (/^[A-Za-z0-9+/=\s]+$/.test(body) && body.length >= 8) {
    return { form: 'compressed', payload: body.replace(/\s+/g, '') }
  }
  return null
}

/** Build a .drawio file (classic inline shape) from an mxGraphModel XML. */
export function buildDrawioFile(xml: string, name = 'Page-1', id = 'p1'): string {
  return (
    '<mxfile host="ollitex" agent="OlliTeX" version="1">\n' +
    `  <diagram id="${id}" name="${name}">${htmlEscape(xml)}</diagram>\n` +
    '</mxfile>\n'
  )
}

/**
 * The DEFAULT new-document graph: a blank A4 page, graph id 0/1 (draw.io's
 * canonical empty model).
 */
/** How often the host polls the app's hash for canvas edits (ms). */
export const drawioHashPollMs = 800

export const DEFAULT_DRAWIO_XML =
  '<mxGraphModel dx="0" dy="0" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="850" pageHeight="1169" math="0" shadow="0"><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel>'

export default {
  parseDrawioFile,
  buildDrawioFile,
  DEFAULT_DRAWIO_XML,
}
