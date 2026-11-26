// overleaf-lab (audit M2): Mongo persistence for compliance review jobs.
//
// The in-process queue in LLMComplianceController stays the EXECUTOR (one
// worker per process), but the job's state and result now live in Mongo, so a
// review that finished (or was already answered) before a server restart is
// still retrievable afterwards instead of 404-ing as "not found or expired".
//
// All helpers here are SAFE: a Mongo hiccup must never break the review flow
// itself — failures are logged and swallowed, and the in-memory path keeps
// answering in that case.
import logger from '@overleaf/logger'
// overleaf-lab: import the raw mongoose package (side-effect-free) so this module
// stays importable in bare unit tests. In the app it is the SAME default instance
// Overleaf's infrastructure/Mongoose.mjs connects.
import mongoose from 'mongoose'

const { Schema } = mongoose

const LLMReviewJobSchema = new Schema(
    {
        jobId: { type: String, required: true, unique: true },
        projectId: { type: String, required: true, index: true },
        userId: { type: String, required: true, index: true },
        rubricId: { type: String, default: '' },
        rubricName: { type: String, default: '' },
        modelOverride: { type: String, default: null },
        status: {
            type: String,
            enum: ['queued', 'running', 'done', 'error', 'cancelled'],
            default: 'queued',
            index: true,
        },
        result: { type: Object, default: null },
        errorCode: { type: String, default: null },
        message: { type: String, default: null },
        documentTokensEstimate: { type: Number, default: null },
        maxContextTokens: { type: Number, default: null },
        reviewMaxTokens: { type: Number, default: null },
        passesTotal: { type: Number, default: null },
        passesDone: { type: Number, default: 0 },
        currentRequirement: { type: String, default: '' },
        createdAt: { type: Date },
        startedAt: { type: Date, default: null },
        finishedAt: { type: Date, default: null },
    },
    // overleaf-lab: bufferCommands off — when the connection is not ready the ops
// reject immediately (and our helpers swallow them) instead of buffering 10s.
{ minimize: false, bufferCommands: false },
)

export const LLMReviewJob = mongoose.model('LLMReviewJob', LLMReviewJobSchema)

function toDate(ms) {
    return typeof ms === 'number' && Number.isFinite(ms) ? new Date(ms) : null
}

// overleaf-lab: the serializable snapshot of the in-memory job object (the live
// `controller` AbortController is intentionally excluded — it is per-process).
function snapshotOf(job) {
    return {
        projectId: job.projectId,
        userId: job.userId,
        rubricId: job.rubricId || '',
        rubricName: job.rubricName || '',
        modelOverride: job.modelOverride || null,
        status: job.status,
        result: job.result || null,
        errorCode: job.errorCode || null,
        message: job.message || null,
        documentTokensEstimate: job.documentTokensEstimate || null,
        maxContextTokens: job.maxContextTokens || null,
        reviewMaxTokens: job.reviewMaxTokens || null,
        passesTotal: job.passesTotal || null,
        passesDone: job.passesDone || 0,
        currentRequirement: job.currentRequirement || '',
        createdAt: toDate(job.createdAt),
        startedAt: toDate(job.startedAt),
        finishedAt: toDate(job.finishedAt),
    }
}

export async function persistJobCreate(job) {
    try {
        await LLMReviewJob.findOneAndUpdate(
            { jobId: job.id },
            { $setOnInsert: { jobId: job.id }, $set: snapshotOf(job) },
            { upsert: true },
        )
    } catch (err) {
        logger.error({ jobId: job.id, err }, '[LLM] compliance job: persist create failed')
    }
}

export async function persistJobUpdate(jobId, job) {
    try {
        await LLMReviewJob.findOneAndUpdate(
            { jobId },
            { $set: snapshotOf(job) },
        )
    } catch (err) {
        logger.error({ jobId, err }, '[LLM] compliance job: persist update failed')
    }
}

export async function findUserJobDoc(jobId, userId) {
    try {
        return await LLMReviewJob.findOne({ jobId, userId }).lean()
    } catch (err) {
        logger.error({ jobId, err }, '[LLM] compliance job: lookup failed')
        return null
    }
}

export async function countUserActiveJobs(userId) {
    try {
        return await LLMReviewJob.countDocuments({
            userId,
            status: { $in: ['queued', 'running'] },
        })
    } catch (err) {
        logger.error({ userId, err }, '[LLM] compliance job: active-count failed')
        return null
    }
}

// overleaf-lab: startup sweep — jobs still 'queued'/'running' belong to a dead
// process by definition (single worker); mark them failed with a clear reason
// so every client gets a definitive answer and the active-count stays honest.
export async function persistStuckJobs(reason) {
    try {
        const res = await LLMReviewJob.updateMany(
            { status: { $in: ['queued', 'running'] } },
            {
                $set: {
                    status: 'error',
                    errorCode: 'server-restarted',
                    message: reason || 'The server restarted while the review was running. Please start it again.',
                    finishedAt: new Date(),
                },
            },
        )
        if (res.modifiedCount > 0) {
            logger.info({ count: res.modifiedCount }, '[LLM] compliance jobs: marked stuck jobs failed after restart')
        }
    } catch (err) {
        logger.error({ err }, '[LLM] compliance jobs: startup sweep failed')
    }
}

export async function persistJobFinalStatus(jobId, patch) {
    try {
        await LLMReviewJob.updateOne({ jobId }, { $set: patch })
    } catch (err) {
        logger.error({ jobId, err }, '[LLM] compliance job: final-status persist failed')
    }
}
