/**
 * overleaf-lab: per-user LLM budget guards (F4).
 *
 * Two guards, both enforced BEFORE a model call:
 *
 *  1. Rate gate: at most RATE_PER_MINUTE LLM calls (chat + completion +
 *     generate) per user per rolling wall-clock minute.
 *  2. Daily token guard: at most DAILY_TOKENS OUTPUT tokens per user per
 *     UTC day (counted from the model-reported usage of successful calls).
 *
 * Counters live in mongo (collection `llmuserbudget`) so they are shared
 * across ALL web worker processes — an in-memory map would only guard each
 * worker (the sharelatex image runs two web nodes behind one nginx).
 * The write per call is a single atomic $inc, negligible next to LLM
 * latency. A TTL index cleans up stale documents automatically.
 *
 * Failure mode is OPEN on counter-store errors (logged): the guard must not
 * take the shared backend down for everyone if the DB hiccups; the daily
 * token guard remains best-effort by design.
 *
 * Env: LLM_USER_RATE_PER_MINUTE (default 60), LLM_USER_DAILY_TOKENS
 * (default 1_000_000).
 */
import logger from '@overleaf/logger'
import mongoose from '../../../../app/src/infrastructure/Mongoose.mjs'

const RATE_PER_MINUTE = Math.max(1, Number.parseInt(process.env.LLM_USER_RATE_PER_MINUTE, 10) || 60)
// Minimum sane daily floor: a few thousand tokens of chat must always fit.
const DAILY_TOKENS = Math.max(1000, Number.parseInt(process.env.LLM_USER_DAILY_TOKENS, 10) || 1_000_000)

// overleaf-lab (bug hunt 2026-11): the collection now holds ONE document per
// user, so the "TTL" index (expireAfterSeconds on a non-Date field) was
// never doing anything — keep the createIndex call for shape compatibility
// but it no longer needs to clean up.
let ready = null
function collection() {
    if (!ready) {
        ready = mongoose.connection.collection('llmUserBudget')
    }
    return ready
}
let indexReady = Promise.resolve()
function ensureIndex() {
    if (!indexReady) {
        indexReady = mongoose.connection
            .collection('llmUserBudget')
            .createIndex({ userId: 1 }, { expireAfterSeconds: 86400 * 2, name: 'ttl' })
        indexReady = indexReady.then(
            () => undefined,
            err => logger.warn({ err }, '[LLMBudget] TTL index (non-fatal)')
        )
    }
    return indexReady
}

function minuteKey() {
    // wall-clock minute bucket (UTC) — rolling minute, no carry-over
    return new Date().toISOString().slice(0, 16)
}
function dayKey() {
    return new Date().toISOString().slice(0, 10)
}

/**
 * Guard BEFORE an LLM call. Throws a normalized error (code 'llm-rate-limited'
 * or 'llm-budget') when the user's rate or daily budget is exhausted.
 * Returns { record(outputTokens) } which MUST be called after a successful
 * call with the model's reported output tokens.
 */
export async function guardLLMCall(userId) {
    if (!userId) {
        return { record: () => {} }
    }
    void ensureIndex()
    const minute = minuteKey()
    const day = dayKey()
    const coll = collection()
    try {
        // overleaf-lab (bug hunt 2026-11): ONE document per user. The previous
        // filter {userId, minute} UPSERTED a fresh document every active
        // minute (thousands per heavy user per day), and the "TTL" index
        // never fires because expireAfterSeconds requires a Date field — the
        // collection would grow unbounded. Single-doc upsert + conditional
        // in-update resets preserve the rolling-minute / per-day semantics.
        const bumped = await coll.findOneAndUpdate(
            { userId },
            [
                {
                    $set: {
                        calls: {
                            $cond: [{ $eq: ['$minute', minute] }, { $add: ['$calls', 1] }, 1],
                        },
                        minute,
                        day,
                        tokens: {
                            $cond: [{ $eq: ['$day', day] }, '$tokens', 0],
                        },
                    },
                },
            ],
            { upsert: true, returnDocument: 'after' }
        )
        if (bumped.calls > RATE_PER_MINUTE) {
            throw Object.assign(
                new Error(`Rate limit reached (${RATE_PER_MINUTE} calls/minute). Wait a minute and try again.`),
                { code: 'llm-rate-limited' }
            )
        }
    } catch (err) {
        if (err && err.code) throw err
        // counter store failure: fail OPEN (log; do not take the service down)
        logger.warn({ err, userId }, '[LLMBudget] rate check unavailable, continuing')
    }

    // Daily token budget (check against the CURRENT day's counter).
    try {
        const doc = await coll.findOne({ userId, day })
        const usedToday = doc && (doc.tokens || 0)
        if (DAILY_TOKENS - usedToday <= 0) {
            throw Object.assign(
                new Error(`Daily token budget reached (${DAILY_TOKENS} tokens/day). Resets at midnight UTC.`),
                { code: 'llm-budget' }
            )
        }
    } catch (err) {
        if (err && err.code) throw err
        logger.warn({ err, userId }, '[LLMBudget] daily check unavailable, continuing')
    }

    return {
        record: (outputTokens) => {
            const tokens = Number(outputTokens) || 0
            if (tokens <= 0) return
            const d = dayKey()
            collection()
                .findOneAndUpdate(
                    { userId, day: d },
                    [{ $set: { tokens: { $add: ['$tokens', tokens] } } }],
                    { upsert: true }
                )
                .catch(err => logger.warn({ err }, '[LLMBudget] token record failed (non-fatal)'))
        },
    }
}

export const LLM_BUDGET_INFO = { RATE_PER_MINUTE, DAILY_TOKENS }

export default { guardLLMCall, LLM_BUDGET_INFO }
