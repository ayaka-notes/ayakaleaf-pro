/*
 * F20 regression: legacy plaintext keys must be normalized to the enc:v1:
 * format on the way into llmProviders, and read back through storedToPlaintext
 * without loss — both directions, plus legacy-pass-through and idempotence.
 */
process.env.LLM_KEY_SECRET = 'deadbeef'.repeat(8)

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
    encryptSecret,
    decryptSecret,
    normalizeStoredSecret,
    storedToPlaintext,
    hasEncPrefix
} from '../../app/src/LLMCrypto.mjs'

test('normalizeStoredSecret: plaintext becomes enc:v1: and round-trips', () => {
    const plain = 'testkey1234567890abcdef'
    const stored = normalizeStoredSecret(plain)
    assert.ok(hasEncPrefix(stored), 'expected enc:v1: prefix, got: ' + stored)
    assert.equal(storedToPlaintext(stored), plain, 'round-trip must return the original key')
})

test('normalizeStoredSecret: already-encrypted value is unchanged (idempotent)', () => {
    const stored = encryptSecret('secret-key-123')
    assert.equal(normalizeStoredSecret(stored), stored)
})

test('normalizeStoredSecret: empty value stays empty string', () => {
    assert.equal(normalizeStoredSecret(''), '')
    assert.equal(normalizeStoredSecret(undefined), '')
})

test('storedToPlaintext: legacy plaintext passes through unchanged', () => {
    assert.equal(storedToPlaintext('plain-legacy-key'), 'plain-legacy-key')
})

test('storedToPlaintext: encrypted value decrypts', () => {
    assert.equal(storedToPlaintext(encryptSecret('abc123')), 'abc123')
})

test('decryptSecret: wrapper remains backward-compatible', () => {
    assert.equal(decryptSecret(encryptSecret('xyz789')), 'xyz789')
    assert.equal(decryptSecret('legacy-plain'), 'legacy-plain')
})
