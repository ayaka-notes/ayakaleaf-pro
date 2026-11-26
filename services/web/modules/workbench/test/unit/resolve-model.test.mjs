// overleaf-lab (ayakaleaf #122 follow-up, upstream comment 2026-10-28):
// regression tests for workbench model selection with attachments.
//
// The upstream bug: with no AI_PDF_MODEL set, a PDF+image history (or an
// earlier rendered page) claimed the IMAGE route, landing PDFs on image-only
// models (vLLM/Qwen-VL accept images but refuse 'file' parts). Fixed: any
// retained PDF routes the whole conversation to pdfModel || model BEFORE the
// image route is considered. BYO lanes always keep the user's lane model.
//
// Run: from services/web — yarn test:unit (or: node --test
// modules/workbench/test/unit/resolve-model.test.mjs)

import { test } from 'node:test'
import assert from 'node:assert/strict'
import Settings from '@overleaf/settings'

import { resolveModel, hasPdf } from '../../app/src/WorkbenchAiClient.mjs'

const pdf = { type: 'file', mediaType: 'application/pdf' }
const image = { type: 'file', mediaType: 'image/png' }
const rendered = { type: 'tool-render_pdf_page', state: 'output-available' }
const msg = (...parts) => ({ role: 'user', parts })

const base = { model: 'text-model', imageModel: 'vision-model' }

function withSettings(s = {}, fn) {
  const prev = Settings.workbenchAi
  Settings.workbenchAi = s
  try {
    return fn()
  } finally {
    Settings.workbenchAi = prev
  }
}

// ── operator gateway (no BYO lane) ────────────────────────────────
for (const [title, messages] of [
  ['PDF only', [msg(pdf)]],
  ['PDF and image in the same message', [msg(pdf, image)]],
  ['image before an earlier PDF', [msg(image), msg(pdf)]],
  ['PDF before an image', [msg(pdf), [msg(image)]]],
  ['PDF followed by a rendered project page', [msg(pdf), { role: 'assistant', parts: [rendered] }]],
]) {
  test(`${title}: without AI_PDF_MODEL the whole conversation keeps AI_MODEL`, () => {
    withSettings({ ...base }, () => {
      assert.equal(resolveModel(messages), 'text-model')
    })
  })

  test(`${title}: a configured AI_PDF_MODEL takes priority`, () => {
    withSettings({ ...base, pdfModel: 'pdf-model' }, () => {
      assert.equal(resolveModel(messages), 'pdf-model')
    })
  })
}

test('empty-string AI_PDF_MODEL falls through to AI_MODEL for mixed attachments', () => {
  withSettings({ ...base, pdfModel: '' }, () => {
    assert.equal(resolveModel([msg(pdf, image)]), 'text-model')
  })
})

test('image-only history still uses AI_IMAGE_MODEL', () => {
  withSettings({ ...base, pdfModel: 'pdf-model' }, () => {
    assert.equal(resolveModel([msg(image)]), 'vision-model')
  })
})

test('rendered page without an attached PDF still uses AI_IMAGE_MODEL', () => {
  withSettings({ ...base, pdfModel: 'pdf-model' }, () => {
    assert.equal(resolveModel([{ role: 'assistant', parts: [rendered] }]), 'vision-model')
  })
})

test('plain text and no-argument callers keep AI_MODEL', () => {
  withSettings({ ...base, pdfModel: 'pdf-model' }, () => {
    assert.equal(resolveModel([msg({ type: 'text', text: 'Hello' })]), 'text-model')
    assert.equal(resolveModel(), 'text-model')
  })
})

// ── BYO lane (owner request: BYO is KING) ─────────────────────────
test('BYO lane always wins, even for PDF+image histories', () => {
  withSettings({ ...base, pdfModel: 'pdf-model' }, () => {
    const lane = { lane: 'user', model: 'byo-qwen3' }
    assert.equal(resolveModel([msg(pdf, image)], lane), 'byo-qwen3')
    assert.equal(resolveModel([msg(image), msg(pdf)], lane), 'byo-qwen3')
  })
})

test('hasPdf detects attachments across the retained history', () => {
  assert.equal(hasPdf([msg(image), msg(pdf)]), true)
  assert.equal(hasPdf([msg(image)]), false)
  assert.equal(hasPdf([msg({ type: 'text', text: 'x' })]), false)
})
