// overleaf-lab (2026): AI Error Assist — unit tests for the pure parts of
// the suggested-fix pipeline (schema, post-call validation, prompt builder).
// No web stack needed: only LLMCompileFix.mjs (zod + plain functions).
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
    compileFixSchema,
    validateCompileFixObject,
    buildCompileFixMessages
} from '../../app/src/LLMCompileFix.mjs'

const validFix = {
    explanation: 'Missing backslash before the macro name.',
    suggestedOld: '\\begin{tabular}{|l|}',
    suggestedNew: '\\begin{tabular}{l|}',
    span: [10, 12]
}

test('schema accepts a well-formed fix', () => {
    const parsed = compileFixSchema.safeParse(validFix)
    assert.equal(parsed.success, true)
    assert.deepEqual(parsed.data.span, [10, 12])
})

test('schema accepts a pure insertion (empty suggestedOld)', () => {
    const parsed = compileFixSchema.safeParse({
        explanation: 'Add the missing preamble package.',
        suggestedOld: '',
        suggestedNew: '\\usepackage{amsmath}'
    })
    assert.equal(parsed.success, true)
})

test('schema accepts a pure deletion (empty suggestedNew, no explanation)', () => {
    // Degenerate-but-meaningful model output observed in the wild: the
    // "different fix" was to delete just the stray characters.
    const parsed = compileFixSchema.safeParse({ suggestedOld: 'aa', suggestedNew: '', span: [1, 1] })
    assert.equal(parsed.success, true)
})

test('validator accepts whitespace-only suggestedNew as a deletion', () => {
    const out = validateCompileFixObject({ suggestedOld: 'aa', suggestedNew: '   ' })
    assert.equal(out.suggestedOld, 'aa')
    assert.equal(out.suggestedNew, '')
    assert.equal(out.explanation, '')
})

test('validator rejects a no-op (both sides empty)', () => {
    assert.throws(
        () => validateCompileFixObject({ suggestionOld: '' , suggestedOld: '', suggestedNew: '' }),
        { code: 'llm-bad-fix' }
    )
    assert.throws(
        () => validateCompileFixObject({ explanation: 'did nothing' }),
        { code: 'llm-bad-fix' }
    )
})

test('validateCompileFixObject trims and keeps an ordered span', () => {
    const out = validateCompileFixObject({
        explanation: '  pad it  ',
        suggestedOld: ' a ',
        suggestedNew: '  b ',
        span: [3, 7]
    })
    assert.equal(out.explanation, 'pad it')
    assert.equal(out.suggestedOld, ' a ') // exact copy: whitespace preserved
    assert.equal(out.suggestedNew, 'b')
    assert.deepEqual(out.span, [3, 7])
})

test('validateCompileFixObject drops an inverted span', () => {
    const out = validateCompileFixObject({
        ...validFix,
        span: [9, 2]
    })
    assert.equal(out.span, null)
})

test('validator rejects non-objects and oversized suggestions', () => {
    assert.throws(
        () => validateCompileFixObject(null),
        { code: 'llm-bad-fix' }
    )
    assert.throws(
        () => validateCompileFixObject(42),
        { code: 'llm-bad-fix' }
    )
    assert.throws(
        () => validateCompileFixObject({
            explanation: 'x',
            suggestedOld: 'a'.repeat(8001),
            suggestedNew: 'b'
        }),
        { code: 'llm-bad-fix' }
    )
    // Oversized explanation is TRUNCATED (the fix itself is still useful)
    // rather than failing the whole request.
    const out = validateCompileFixObject({
        explanation: 'x'.repeat(7000),
        suggestedOld: 'a',
        suggestedNew: 'b'
    })
    assert.ok(out.explanation.length <= 6000)
})

test('pure insertion (empty suggestedOld) is valid', () => {
    const out = validateCompileFixObject({
        explanation: 'Add the missing package.',
        suggestedOld: '',
        suggestedNew: '\\usepackage{amsmath}'
    })
    assert.equal(out.suggestedOld, '')
    assert.equal(out.suggestedNew, '\\usepackage{amsmath}')
    assert.equal(out.span, null)
})

test('buildCompileFixMessages carries the contract, entry and source window', () => {
    const messages = buildCompileFixMessages({
        level: 'error',
        file: 'main.tex',
        line: 42,
        message: '! Missing $ inserted.',
        snippet: '>' + '  42: \\begin{eqnarray}\n   43: b',
        hint: '',
        adminPrompt: ''
    })
    assert.equal(messages.length, 2)
    assert.match(messages[0].content, /exact copy of the current text/i)
    assert.match(messages[0].content, /MINIMAL/i)
    assert.match(messages[0].content, /backslash/i)
    assert.match(messages[1].content, /Missing \$ inserted/)
    assert.match(messages[1].content, /main\.tex, line 42/)
    assert.match(messages[1].content, />\s*42: /)
})

test('buildCompileFixMessages includes the avoid-hint on re-roll', () => {
    const messages = buildCompileFixMessages({
        level: 'error',
        file: 'f.tex',
        line: 3,
        message: 'err',
        snippet: '> 3: x',
        hint: { old: 'x', new: 'y' },
        adminPrompt: ''
    })
    assert.match(messages[1].content, /DIFFERENT suggestion/i)
    assert.match(messages[1].content, /old: x/)
    assert.match(messages[1].content, /new: y/)
    assert.doesNotMatch(messages[1].content, /Deployment instruction/)
})

test('buildCompileFixMessages uses the admin prompt only when given', () => {
    const messages = buildCompileFixMessages({
        level: 'error',
        file: 'f.tex',
        line: 3,
        message: 'err',
        snippet: '> 3: x',
        hint: '',
        adminPrompt: 'Prefer minimal patches.'
    })
    assert.match(messages[1].content, /Prefer minimal patches/)
})
