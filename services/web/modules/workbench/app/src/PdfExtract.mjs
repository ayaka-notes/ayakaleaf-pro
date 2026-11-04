/**
 * overleaf-lab (2026-11, owner request): server-side text extraction so
 * text-only LLM lanes can still make sense of image / PDF attachments.
 *
 * The owner's reference pipeline (pdf_ocr_ollama.mjs / pdf_ollama.mjs)
 * translated directly onto the server:
 *   text-based PDF  -> pdftotext (poppler-utils, already in the base image)
 *   scanned PDF     -> ocrmypdf (Tesseract) -> pdftotext
 *   image           -> tesseract (eng+deu)
 *
 * Nothing here talks to an LLM; it only turns attachment bytes into text.
 * The workbench controller swaps the file parts for text parts when the
 * user's setting (User.llmTextExtract) is on. Binaries are shell-spawned;
 * no new npm dependencies.
 */
import { spawn, spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import logger from '@overleaf/logger'

// ~50K tokens of context headroom, same cap as the owner's script.
const MAX_CHARS = 150_000
const OCR_LANGS = 'eng+deu'
const ATTACH_TIMEOUT_MS = 90_000
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024
const MIN_USEFUL_CHARS = 40 // below this, treat the PDF as scanned

/**
 * Run a command; resolves { status, stdout, stderr, timedOut }. Non-zero
 * statuses are data conditions here (a scan that OCR cannot read), so they
 * resolve rather than reject. Rejects only on spawn failures. Output caps
 * keep a pathological page from wedging the process.
 */
function run(cmd, args, { timeoutMs = ATTACH_TIMEOUT_MS, maxBuffer = 128 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    let child
    try {
      child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (err) {
      reject(err)
      return
    }
    let stdout = ''
    let stderr = ''
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      try { child.kill('SIGKILL') } catch { /* already dead */ }
      resolve({ status: -1, stdout, stderr: stderr + '\n[timeout]', timedOut: true })
    }, timeoutMs)
    const finish = (obj) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(obj)
    }
    child.stdout.on('data', d => {
      stdout += d
      if (stdout.length > maxBuffer) {
        try { child.kill('SIGKILL') } catch { /* noop */ }
        finish({ status: -1, stdout, stderr: stderr + '\n[output cap exceeded]', timedOut: true })
      }
    })
    child.stderr.on('data', d => {
      stderr += d
      if (stderr.length > 8 * 1024 * 1024) stderr = stderr.slice(0, 8 * 1024 * 1024)
    })
    child.on('error', err => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(err)
    })
    child.on('close', status => {
      finish({ status: status === null ? -1 : status, stdout, stderr, timedOut: false })
    })
  })
}

function hasBinary(name) {
  const r = spawnSync('command -v', [name], { shell: true, encoding: 'utf8' })
  return r.status === 0 && (r.stdout || '').trim().length > 0
}

// Capability probe once per process, cached. A missing binary degrades the
// mode (failed attachments keep their raw part, so the usual provider-side
// refusal + hint still explains the situation) — it must never crash chat.
let caps = null
export function capabilities() {
  if (!caps) {
    caps = {
      pdftotext: hasBinary('pdftotext'),
      ocrmypdf: hasBinary('ocrmypdf'),
      tesseract: hasBinary('tesseract'),
    }
  }
  return caps
}

function capText(text) {
  let t = String(text || '').replace(/\u0000/g, '').trim()
  if (t.length > MAX_CHARS) {
    t = t.slice(0, MAX_CHARS) + `\n\n[... truncated at ${MAX_CHARS.toLocaleString()} characters ...]`
  }
  return t
}

/** Text-based PDF first (fast path), then the OCR stage for scans. */
async function extractFromPdf(buf, tmp) {
  const inPdf = path.join(tmp, 'in.pdf')
  await writeFile(inPdf, buf)

  const direct = await run('pdftotext', ['-layout', inPdf, '-'])
  const directText = (direct.stdout || '').trim()
  if (directText.length >= MIN_USEFUL_CHARS) {
    return { text: capText(directText), ocrRan: false }
  }

  const ocrPdf = path.join(tmp, 'ocr.pdf')
  if (capabilities().ocrmypdf) {
    const ocr = await run('ocrmypdf', [
      '--skip-text',
      '--language', OCR_LANGS,
      '--output-type', 'pdf',
      '--optimize', '0',
      '--quiet',
      inPdf,
      ocrPdf,
    ])
    if (ocr.status === 0 && existsSync(ocrPdf)) {
      const text = await run('pdftotext', ['-layout', ocrPdf, '-'])
      const ocrText = (text.stdout || '').trim()
      if (ocrText.length >= 20) {
        return { text: capText(ocrText), ocrRan: true }
      }
    }
  }

  // Nothing legible via OCR — hand over whatever direct text there was
  // (fragments, headers) instead of nothing.
  return { text: capText(directText), ocrRan: false }
}

function imageExt(mediaType) {
  switch (mediaType) {
    case 'image/jpeg': return 'jpg'
    case 'image/webp': return 'webp'
    case 'image/bmp': return 'bmp'
    case 'image/tiff': return 'tif'
    default: return 'png'
  }
}

async function extractFromImage(buf, mediaType, tmp) {
  const inFile = path.join(tmp, 'img.' + imageExt(mediaType))
  await writeFile(inFile, buf)
  const text = await run('tesseract', [
    inFile,
    '-',
    '--psm', '3',
    '--language', OCR_LANGS,
  ])
  return { text: capText(text.stdout || ''), ocrRan: true }
}

/**
 * Replace image/PDF attachment parts with server-extracted text.
 * All attachments run in parallel; the report feeds one logger line.
 * Failed attachments keep their original part so the normal refusal path
 * (e.g. ai_pdf_not_supported) and its UI hint still apply unchanged.
 *
 * Returns { messages, report, caps }.
 */
export async function toTextMessages(messages) {
  const caps = capabilities()
  const report = []
  const jobs = []
  const jobByPart = new Map()

  for (const message of messages || []) {
    if (!Array.isArray(message?.parts)) continue
    for (const part of message.parts) {
      if (part?.type !== 'file') continue
      const mt = String(part?.mediaType || '')
      const isPdf = mt === 'application/pdf'
      if (!isPdf && !mt.startsWith('image/')) continue
      const prefix = `data:${mt};base64,`
      const url = String(part?.url || '')
      if (!url.startsWith(prefix)) continue // attachment validation rejects these anyway

      const meta = { kind: isPdf ? 'pdf' : 'image', name: part?.filename || 'attachment' }
      jobs.push(
        (async () => {
          const fail = (reason) => ({ ...meta, part, text: null, mode: 'failed', reason })
          if (isPdf && !(caps.pdftotext || caps.ocrmypdf)) return fail('binaries')
          if (!isPdf && !caps.tesseract) return fail('binaries')
          let buf
          try {
            buf = Buffer.from(url.slice(prefix.length), 'base64')
          } catch {
            return fail('decode')
          }
          if (buf.length === 0) return fail('empty')
          if (buf.length > MAX_ATTACHMENT_BYTES) return fail('size')
          const tmp = await mkdtemp(path.join(os.tmpdir(), 'wbx-'))
          try {
            const result = isPdf
              ? await extractFromPdf(buf, tmp)
              : await extractFromImage(buf, mt, tmp)
            if (!result.text) return fail('no-text')
            return {
              ...meta,
              part,
              text: result.text,
              mode: result.ocrRan ? 'ocr' : 'text',
              ocrRan: result.ocrRan,
              chars: result.text.length,
            }
          } finally {
            try { await rm(tmp, { recursive: true, force: true }) } catch { /* best effort */ }
          }
        })()
      )
      jobByPart.set(part, jobs[jobs.length - 1])
    }
  }
  const results = await Promise.all(jobs)

  const outMessages = (messages || []).map(message => {
    if (!Array.isArray(message?.parts)) return message
    const newParts = message.parts.map(part => {
      const r = jobByPart.get(part)
      if (!r) return part // not an extractable attachment
      if (!r.text) {
        report.push({ name: r.name, kind: r.kind, mode: 'failed', reason: r.reason })
        return part
      }
      report.push({ name: r.name, kind: r.kind, mode: r.mode, chars: r.chars, ocrRan: r.ocrRan })
      return {
        type: 'text',
        text:
          `Attached file "${r.name}" ${
            r.ocrRan
              ? `was scanned; Tesseract (${OCR_LANGS}) OCR'd it into text before it reached the model — the model never sees the original image:`
              : 'had its text extracted on the server before it reached the model — the model never sees the original image:'
          }\n\n${r.text}`,
      }
    })
    return { ...message, parts: newParts }
  })

  if (report.length) {
    logger.info({ report, caps }, 'workbench chat: text-extraction mode processed attachments')
  }
  return { messages: outMessages, report, caps }
}

export default { capabilities, toTextMessages }
