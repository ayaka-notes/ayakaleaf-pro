// overleaf-lab: offline unit tests for the LLM provider seam and pure helpers.
// These never touch the network: they validate spec normalization, provider-type
// detection, response cleanup, token estimation, and the model-ref parser.
//
// Run: node --test app/test/llm-client.test.mjs
// A live end-to-end smoke against a real backend lives separately in
// LLMClient.live.mjs (run it manually, not via `node --test`).

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
    normalizeProviderSpec,
    detectProviderType,
    stripThinkTags,
    estimateTokens,
    assertNonEmpty,
    PROVIDER_TYPES
} from '../../app/src/LLMClient.mjs'
import { parseModelRef } from '../../app/src/LLMModelRef.mjs'

test('PROVIDER_TYPES exposes exactly the three supported adapters', () => {
    assert.deepEqual(
        [...PROVIDER_TYPES].sort(),
        ['anthropic', 'openai', 'openaiCompatible']
    )
})

test('normalizeProviderSpec: openai-compatible URL keeps /v1', () => {
    const spec = normalizeProviderSpec(
        { providerType: 'openaiCompatible', baseUrl: 'http://host:11434/v1/', apiKey: 'ollama' },
        { model: 'qwen' }
    )
    assert.equal(spec.baseUrl, 'http://host:11434/v1')
    assert.equal(spec.model, 'qwen')
    assert.equal(spec.apiKey, 'ollama')
})

test('normalizeProviderSpec: anthropic base URL has /v1 stripped (SDK appends it)', () => {
    const spec = normalizeProviderSpec(
        { providerType: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', apiKey: 'sk-ant' },
        { model: 'claude' }
    )
    assert.equal(spec.baseUrl, 'https://api.anthropic.com')
})

test('normalizeProviderSpec: legacy field names (llmApiType/llmApiUrl/llmApiKey) migrate', () => {
    const spec = normalizeProviderSpec(
        { llmApiType: 'openai', llmApiUrl: 'https://api.openai.com/v1', llmApiKey: 'sk' },
        { model: 'gpt-4o' }
    )
    assert.equal(spec.providerType, 'openai')
    assert.equal(spec.baseUrl, 'https://api.openai.com/v1')
    assert.equal(spec.apiKey, 'sk')
})

test('normalizeProviderSpec: missing model is a typed bad-config error', () => {
    assert.throws(
        () => normalizeProviderSpec({ providerType: 'openai' }, {}),
        (err) => err.code === 'llm-bad-config'
    )
})

test('normalizeProviderSpec: unknown providerType is a typed bad-config error', () => {
    assert.throws(
        () => normalizeProviderSpec({ providerType: 'nope' }, { model: 'x' }),
        (err) => err.code === 'llm-bad-config'
    )
})

test('detectProviderType routes vendor URLs to the right adapter', () => {
    assert.equal(detectProviderType('https://api.anthropic.com/v1'), 'anthropic')
    assert.equal(detectProviderType('https://api.openai.com/v1'), 'openai')
    assert.equal(detectProviderType('http://localhost:11434/v1'), 'openaiCompatible')
    assert.equal(detectProviderType(''), 'openaiCompatible')
})

test('stripThinkTags removes the tag markers and keeps inner content', () => {
    const OPEN = '<' + 'think>'
    const CLOSE = '<' + '/think>'
    assert.equal(stripThinkTags('a ' + OPEN + 'b' + CLOSE), 'a b')
    assert.equal(stripThinkTags(OPEN + 'only' + CLOSE), 'only')
    assert.equal(stripThinkTags('no tags'), 'no tags')
})

test('estimateTokens is conservative and never zero', () => {
    assert.equal(estimateTokens(''), 1)
    // ~3.5 chars/token => 35 chars => 10 tokens
    assert.equal(estimateTokens('x'.repeat(35)), 10)
})

test('assertNonEmpty returns trimmed text and throws a typed error when empty', () => {
    assert.equal(assertNonEmpty('  hi  '), 'hi')
    assert.throws(() => assertNonEmpty('   '), (err) => err.code === 'empty-response')
    assert.throws(() => assertNonEmpty(''), (err) => err.code === 'empty-response')
})

test('parseModelRef: bare id is the site lane', () => {
    assert.deepEqual(parseModelRef('qwen3.8:latest'), { kind: 'site', model: 'qwen3.8:latest' })
})

test('parseModelRef: namespaced id resolves the user row + model', () => {
    assert.deepEqual(parseModelRef('u:1234abcd:gpt-4o'), {
        kind: 'user',
        rowId: '1234abcd',
        model: 'gpt-4o'
    })
})

test('parseModelRef: empty/undefined falls back to the site default lane', () => {
    assert.deepEqual(parseModelRef(''), { kind: 'site', model: '' })
    assert.deepEqual(parseModelRef(undefined), { kind: 'site', model: '' })
})
