/**
 * LaneCapability.mjs - overleaf-lab (2026-11-05, owner report): the workbench
 * chat must not blind-send an attachment shape a user's lane rejects.
 *
 * OpenAI-compatible relays (Ollama, vLLM, llama.cpp) are common BYO targets:
 * they accept `image_url` content parts but NOT OpenAI `file` document parts,
 * and text-only models reject images entirely. The provider answers with a
 * 400/415/422, which used to surface as a generic refusal even though the
 * SAME content would work if we converted it to text first (the server has
 * the pdftotext/Tesseract pipeline for exactly that).
 *
 * probeLane() asks the lane itself, once per model per hour (in-process
 * cache), whether it accepts (1) an image part and (2) a PDF file part.
 * Two tiny non-streaming calls, max 2 completion tokens each.
 *
 *   images: true  — the lane answered 2xx to an image part
 *          false  — the lane answered 400/415/422 → treat it as text-only
 *          null   — unknown (network error, 5xx, unusual status) → keep the
 *                   native part and let the existing refusal path explain
 *   pdf:    same semantics for an OpenAI file part.
 *
 * The probes are raw fetches: they are NOT metered into the usage ledger
 * (a couple of tokens, at most once per model per hour, per process).
 */
import logger from '@overleaf/logger'

const TTL_MS = 60 * 60 * 1000
const cache = new Map()

// 8×8 red PNG (Qwen-VL-family vision encoders reject ~1×1 images — 1×1 gave
// a false "no images" answer for image-capable relays; 8×8 is the smallest
// size verified accepted by qwen3.8:latest on this relay).
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP8z4AdMOEQH6QSAM1BAQ/oQeJvAAAAAElFTkSuQmCC'

// Minimal valid one-page PDF (text "probe").
const PDF_MIN = [
  '%PDF-1.4\n',
  '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
  '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
  '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 60 60] /Contents 4 0 R >>\nendobj\n',
  '4 0 obj\n<< /Length 15 >>\nstream\nBT /F1 8 Tf 10 30 Td (probe) Tj ET\nendstream\nendobj\n',
  'xref\n0 5\n',
  '0000000000 65535 f \n',
  '0000000009 00000 n \n',
  '0000000058 00000 n \n',
  '0000000113 00000 n \n',
  '0000000164 00000 n \n',
  'trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n239\n%%EOF\n',
].join('')
const PDF_B64 = Buffer.from(PDF_MIN, 'utf8').toString('base64')

async function probePart(baseURL, apiKey, model, content) {
  const url = String(baseURL || '').replace(/\/+$/, '') + '/chat/completions'
  if (!url) return null
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 15000)
  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model,
        stream: false,
        max_tokens: 2,
        messages: [{ role: 'user', content }],
      }),
    })
    if (res.status >= 200 && res.status < 300) return true
    if ([400, 415, 422].includes(res.status)) return false
    return null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Resolve the attachment capabilities of a user lane.
 * Returns { images: true|false|null, pdf: true|false|null }, or null when
 * anything is unusable (callers keep the native behaviour then).
 */
export async function probeLane(baseURL, apiKey, model) {
  if (!baseURL || !model) return null
  const key = `${String(baseURL).replace(/\/+$/, '')}|${model}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.cap
  const [images, pdf] = await Promise.all([
    probePart(baseURL, apiKey, model, [
      { type: 'text', text: 'ping' },
      { type: 'image_url', image_url: { url: `data:image/png;base64,${PNG_B64}` } },
    ]),
    probePart(baseURL, apiKey, model, [
      { type: 'text', text: 'ping' },
      {
        type: 'file',
        file: { filename: 'capability-probe.pdf', file_data: `data:application/pdf;base64,${PDF_B64}` },
      },
    ]),
  ])
  const cap = { images, pdf }
  cache.set(key, { at: Date.now(), cap })
  logger.info(
    { model, images, pdf },
    '[workbench] lane attachment capability probe'
  )
  return cap
}

/** Drop the stored capability for tests or after a provider change. */
export function clearLaneCapabilityCache() {
  cache.clear()
}

export default { probeLane, clearLaneCapabilityCache }
