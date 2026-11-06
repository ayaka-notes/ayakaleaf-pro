// overleaf-lab (usage meter): pure/offline tests for the LLMUsage module —
// the schema, the day-bucket helper, and that the persist path is non-fatal
// without a Mongo connection.
import test from 'node:test'
import assert from 'node:assert/strict'
import { LLMUsage, recordUsage, getUsageSummary, dayBucket } from '../../app/src/LLMUsage.mjs'

test('usage schema: identity fields + day bucket + indexes', () => {
    const s = LLMUsage.schema
    assert.equal(s.path('userId').options.index, true)
    assert.ok(['Mixed', 'Object', 'String'].includes(s.path('day').instance) || s.path('day').instance === 'String')
    assert.equal(s.path('inputTokens').instance, 'Number')
})

test('dayBucket: YYYY-MM-DD', () => {
    const d = new Date(2026, 6, 5) // July 5th 2026 (local)
    assert.equal(dayBucket(d), '2026-07-05')
    const d2 = new Date(2026, 11, 31)
    assert.equal(dayBucket(d2), '2026-12-31')
})

test('recordUsage: offline it resolves (non-fatal), never throws', async () => {
    const p = recordUsage({ userId: 'u1', action: 'chat', lane: 'site' }, {
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
    })
    assert.ok(p instanceof Promise)
    await p
})

test('recordUsage: null/empty usage stays a quiet no-op', async () => {
    await recordUsage({ userId: 'u1', action: 'chat' }, null)
    await recordUsage(null, { inputTokens: 0, outputTokens: 0, totalTokens: 0 })
})

test('getUsageSummary: offline it returns null (never throws)', async () => {
    const summary = await getUsageSummary({ userId: 'u1', days: 30 })
    assert.equal(summary, null)
    const site = await getUsageSummary({ days: 7 })
    assert.equal(site, null)
})
