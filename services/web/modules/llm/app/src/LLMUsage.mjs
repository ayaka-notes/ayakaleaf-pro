// overleaf-lab (owner request 2026-08-28): LLM usage meter — token accounting
// for the admin and user settings pages.
//
// Design goals (kept deliberately small):
//   * ONE capture point: LLMClient.chatText/chatObject record whatever
//     `options.usageMeta` the call site supplied. No per-feature bookkeeping,
//     no double counting.
//   * NON-FATAL: the app has no business crashing an LLM call (or a settings
//     page fetch) because the usage store is unavailable. Every Mongo op is
//     wrapped, errors logged and swallowed.
//   * READS are aggregate-backed and bounded (day histogram + top-N), so the
//     settings pages stay fast even with a large history.
import logger from '@overleaf/logger'
// overleaf-lab: raw mongoose (same default instance the app connects), importable
// in bare unit tests. See LLMReviewJob for the same pattern.
import mongoose from 'mongoose'

const { Schema } = mongoose

const LLMUsageSchema = new Schema(
    {
        userId: { type: String, default: null, index: true }, // null = site/admin scope
        projectId: { type: String, default: null },
        action: { type: String, default: '' }, // chat | completion | review | ask-ai | generate | compile-fix | check
        lane: { type: String, default: '' }, // site | user:<rowId>
        model: { type: String, default: '' },
        inputTokens: { type: Number, default: 0 },
        outputTokens: { type: Number, default: 0 },
        totalTokens: { type: Number, default: 0 },
        day: { type: String, default: '' }, // local date bucket 'YYYY-MM-DD' for cheap grouping
        createdAt: { type: Date, default: Date.now },
    },
    { minimize: false, bufferCommands: false },
)

export const LLMUsage = mongoose.model('LLMUsage', LLMUsageSchema)

// overleaf-lab: day bucketing uses the server's local day (this deployment is
// single-machine; consistent with "30 days" expectations on the UI).
function dayBucket(d = new Date()) {
    const p = n => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

function num(v) {
    return Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.round(Number(v)) : 0
}

// overleaf-lab: record one successful model call. Fire-and-forget safe: the
// returned promise never rejects.
export function recordUsage(meta, usage) {
    const job = (async () => {
        const u = usage || {}
        const input = num(u.inputTokens)
        const output = num(u.outputTokens)
        const total = num(u.totalTokens) || input + output
        if (!total) {
            // no token data at all — nothing to meter (do not pollute the store)
            return
        }
        await LLMUsage.create({
            userId:
                meta?.userId != null && String(meta.userId).length > 12
                    ? String(meta.userId).slice(0, 60)
                    : null,
            projectId:
                meta?.projectId != null ? String(meta.projectId).slice(0, 60) : null,
            action: String(meta?.action || '').slice(0, 40),
            lane: String(meta?.lane || '').slice(0, 60),
            model: String(meta?.model || '').slice(0, 200),
            inputTokens: input,
            outputTokens: output,
            totalTokens: total,
            day: dayBucket(),
            createdAt: new Date(),
        })
    })()
    return job.catch(err => {
        logger.debug({ err }, '[LLMUsage] record failed (non-fatal)')
    })
}

// overleaf-lab: aggregate a window of usage.
//   userId: string -> only that user; null/undefined -> the whole site.
// Returns { days, calls, inputTokens, outputTokens, totalTokens, byDay, byAction, byModel }
// or null when the store cannot be reached (UI then shows a muted "unavailable").
export async function getUsageSummary({ userId, days = 30 } = {}) {
    const limit = Math.min(Math.max(Number(days) || 30, 1), 365)
    try {
        const from = new Date()
        from.setHours(0, 0, 0, 0)
        from.setDate(from.getDate() - (limit - 1))
        const filter = {
            createdAt: { $gte: from },
            ...(userId != null ? { userId: String(userId) } : {}),
        }

        const [tot, perDay, perAction, perModel] = await Promise.all([
            LLMUsage.aggregate([
                { $match: filter },
                {
                    $group: {
                        _id: null,
                        calls: { $sum: 1 },
                        inputTokens: { $sum: '$inputTokens' },
                        outputTokens: { $sum: '$outputTokens' },
                        totalTokens: { $sum: '$totalTokens' },
                    },
                },
            ]),
            LLMUsage.aggregate([
                { $match: filter },
                {
                    $group: { _id: '$day', calls: { $sum: 1 }, totalTokens: { $sum: '$totalTokens' } },
                },
                { $sort: { _id: 1 } },
            ]),
            LLMUsage.aggregate([
                { $match: filter },
                {
                    $group: { _id: '$action', calls: { $sum: 1 }, totalTokens: { $sum: '$totalTokens' } },
                },
                { $sort: { totalTokens: -1 } },
                { $limit: 12 },
            ]),
            LLMUsage.aggregate([
                { $match: filter },
                {
                    $group: { _id: '$model', calls: { $sum: 1 }, totalTokens: { $sum: '$totalTokens' } },
                },
                { $sort: { totalTokens: -1 } },
                { $limit: 8 },
            ]),
        ])

        // fill the full day range so the UI gets a contiguous bar series
        const byDay = []
        const dayMap = new Map(perDay.map(r => [r._id, r]))
        const cursor = new Date(from)
        while (cursor <= new Date()) {
            const d = dayBucket(cursor)
            byDay.push({ day: d, calls: dayMap.has(d) ? dayMap.get(d).calls : 0, totalTokens: dayMap.has(d) ? dayMap.get(d).totalTokens : 0 })
            cursor.setDate(cursor.getDate() + 1)
        }

        return {
            days: limit,
            calls: tot[0]?.calls || 0,
            inputTokens: tot[0]?.inputTokens || 0,
            outputTokens: tot[0]?.outputTokens || 0,
            totalTokens: tot[0]?.totalTokens || 0,
            byDay,
            byAction: perAction.map(r => ({ action: r._id || 'other', calls: r.calls, totalTokens: r.totalTokens })),
            byModel: perModel.map(r => ({ model: r._id || 'unknown', calls: r.calls, totalTokens: r.totalTokens })),
        }
    } catch (err) {
        logger.debug({ err }, '[LLMUsage] summary failed (non-fatal)')
        return null
    }
}

export { dayBucket }
