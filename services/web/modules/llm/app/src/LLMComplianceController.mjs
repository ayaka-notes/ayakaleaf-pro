import logger from '@overleaf/logger'
import Settings from '@overleaf/settings'
import { expressify } from '@overleaf/promise-utils'
import SessionManager from '../../../../app/src/Features/Authentication/SessionManager.mjs'
import ProjectEntityHandler from '../../../../app/src/Features/Project/ProjectEntityHandler.mjs'
import { getAdminLLMSettings, getLLMFeatureFlags, getLLMPrompts } from './LLMAdminController.mjs'
import { getComplianceRubricsForUser } from './LLMSettingsController.mjs' // overleaf-lab (2026-08-27): user-scoped rubrics
import OError from '@overleaf/o-error'
import { chatText, chatObject, listModels as listModelsSdk, normalizeProviderSpec } from './LLMClient.mjs' // overleaf-lab: AI-SDK provider seam (PR item 4: provider-agnostic review passes)
// overleaf-lab: Review-tab model selector — resolve an explicit model ref (site
// model id or 'u:<rowId>:<model>') to the right lane + spec.
import { resolveModelLane } from './LLMChatController.mjs'
// overleaf-lab (audit M2): Mongo persistence for review jobs — survives restarts.
import {
    persistJobCreate,
    persistJobUpdate,
    persistJobFinalStatus,
    persistStuckJobs,
    findUserJobDoc,
    countUserActiveJobs,
} from './models/LLMReviewJob.mjs'

// overleaf-lab: in-memory job queue for compliance reviews. A review sends the
// whole project to the LLM and can run for minutes, so we run one at a time per
// web process and let the client poll a job for progress, cancel, and result.
const jobs = new Map() // jobId -> job
const queue = [] // array of jobId, FIFO
let running = false // one review at a time
// overleaf-lab: keep finished jobs for 30 min so a re-poll after a tab switch still
// returns the result instead of a not_found. A large review can finish long after the
// user last looked at the panel, so the retention must be generous.
const JOB_TTL_MS = 30 * 60 * 1000

// overleaf-lab: F6 — concurrency caps (enforced in startReview).
const MAX_USER_REVIEWS_IN_FLIGHT = 3 // 1 running + 2 queued per user
const MAX_GLOBAL_QUEUE = 5 // queued jobs across all users

// overleaf-lab: FALLBACK token budget for the review's JSON answer, used when the
// admin has not set one in the LLM settings page (which is the normal way to change
// it). The effective value is BOTH the hard max_tokens sent to the model AND the room
// the context-window guard reserves for the answer, so raising it slightly lowers the
// largest single-pass document and lengthens the worst-case review.
const REVIEW_MAX_TOKENS =
    Number.parseInt(process.env.LLM_REVIEW_MAX_TOKENS, 10) > 0
        ? Number.parseInt(process.env.LLM_REVIEW_MAX_TOKENS, 10)
        : 12000

// overleaf-lab: F6 — maximum model passes per review job (see the cap where
// mainPassCount is computed).
const MAX_PASSES_PER_JOB = Number.parseInt(process.env.LLM_REVIEW_MAX_PASSES, 10) > 0
    ? Number.parseInt(process.env.LLM_REVIEW_MAX_PASSES, 10)
    : 200

// overleaf-lab: rough backend throughput, now used only to SIZE THE PER-PASS TIMEOUT
// (progress is pass-based and needs no time estimate, so a wrong rate can only make
// the safety timeout more generous, never mislead the user).
// An explicit env value always wins (an operator pinning a number), otherwise we use
// what we MEASURED from the backend, otherwise these last-resort fallbacks. The
// fallbacks are CPU-era numbers and are wrong by ~2 orders of magnitude on a GPU, so
// they must never be the normal path: see measuredPrefillTps below.
const ENV_PREFILL_TPS =
    Number.parseFloat(process.env.LLM_REVIEW_PREFILL_TPS) > 0
        ? Number.parseFloat(process.env.LLM_REVIEW_PREFILL_TPS)
        : null
const ENV_GEN_TPS =
    Number.parseFloat(process.env.LLM_REVIEW_GEN_TPS) > 0
        ? Number.parseFloat(process.env.LLM_REVIEW_GEN_TPS)
        : null
const FALLBACK_PREFILL_TPS = 80
const FALLBACK_GEN_TPS = 4

// overleaf-lab: throughput measured from the backend. llama.cpp reports
// timings.prompt_per_second / predicted_per_second on every response, so each real
// review calibrates the next one for free. Process-local on purpose: after a restart
// the first review just runs on the fallbacks (only the timeout cap depends on this).
let measuredPrefillTps = null
let measuredGenTps = null

// overleaf-lab: AI-SDK seam for review passes. currentBaseSpec is set per job
// from the effective admin settings; llmChat() derives the full spec from the
// body's model (same body shape as the old provider calls).
let currentBaseSpec = null

// overleaf-lab (usage meter): set per job by performReview — the in-process
// review worker is single-flight, so one module-level meta is race-free.
let currentUsageMeta = null

function specFor(model) {
    return normalizeProviderSpec(currentBaseSpec || {}, { model })
}

const STRUCTURED_FALLBACK_CODES = new Set(['empty-response', 'llm-error'])

async function chatDetailedCompat(spec, body, opts = {}) {
    const schema = body.response_format?.json_schema?.schema
    const call = {
        maxOutputTokens: body.max_tokens,
        temperature: body.temperature,
        signal: opts.signal,
        timeoutMs: opts.timeoutMs,
        usageMeta: opts.usageMeta, // overleaf-lab (usage meter)
    }
    try {
        if (schema) {
            const { object } = await chatObject(spec, body.messages, schema, call)
            return { content: JSON.stringify(object), raw: {} }
        }
        const { text } = await chatText(spec, body.messages, call)
        return { content: text, raw: {} }
    } catch (err) {
        if (err && (err.code === 'llm-abort' || /abort/i.test(String(err.name || '')))) {
            throw err
        }
        if (schema && STRUCTURED_FALLBACK_CODES.has(err?.code)) {
            // The backend does not honor structured output (or the strict parse
            // failed): ask for plain JSON text and let the caller's extractJson
            // + retry loop do the tolerant work.
            try {
                const { text } = await chatText(spec, body.messages, call)
                return { content: text, raw: {} }
            } catch (fallbackErr) {
                throw err
            }
        }
        throw err
    }
}

function llmChat(body, opts) {
    // overleaf-lab (usage meter): every review pass is metered under the job
    // owner (set by performReview).
    return chatDetailedCompat(specFor(body.model), body, { ...opts, usageMeta: currentUsageMeta })
}

// overleaf-lab: sample-size gates for trusting a timings measurement. llama.cpp
// reports prompt_per_second over the tokens it ACTUALLY evaluated (prompt_n): on a
// prompt-cache hit that can be a single token, and the resulting "rate" is pure
// per-request overhead (~76 tok/s observed where the true prefill was ~5400), so
// accepting it would poison a good calibration. Two tiers: a STRONG sample (a real
// review) always updates; a smaller one is accepted only as the FIRST seed of an
// empty calibration and never below the MIN floor, so a cache-hit rerun (prompt_n=1)
// can never become the calibration.
const STRONG_PREFILL_N = 2048
const STRONG_GEN_N = 256
const MIN_PREFILL_N = 64
const MIN_GEN_N = 8

function effectiveRates() {
    return {
        prefillTps: ENV_PREFILL_TPS || measuredPrefillTps || FALLBACK_PREFILL_TPS,
        genTps: ENV_GEN_TPS || measuredGenTps || FALLBACK_GEN_TPS,
    }
}

// overleaf-lab: learn the rates from a llama.cpp `timings` block. Ignored silently for
// backends that do not report it (OpenAI and friends), which keep env/fallback. A
// missing prompt_n/predicted_n rejects the sample too (NaN fails every >=), since a
// rate without its sample size cannot be judged.
function recordTimings(timings) {
    if (!timings || typeof timings !== 'object') {
        return
    }
    const prefill = Number(timings.prompt_per_second)
    const prefillN = Number(timings.prompt_n)
    const gen = Number(timings.predicted_per_second)
    const genN = Number(timings.predicted_n)
    if (
        Number.isFinite(prefill) &&
        prefill > 0 &&
        (prefillN >= STRONG_PREFILL_N ||
            (measuredPrefillTps === null && prefillN >= MIN_PREFILL_N))
    ) {
        measuredPrefillTps = prefill
    }
    if (
        Number.isFinite(gen) &&
        gen > 0 &&
        (genN >= STRONG_GEN_N || (measuredGenTps === null && genN >= MIN_GEN_N))
    ) {
        measuredGenTps = gen
    }
}

// overleaf-lab: provider errors arrive as OError (BaseProvider.handleError) whose
// CAUSE carries the transport-level failure, so abort detection must look one
// level deeper than a bare fetch() would. Both the user cancel and the pass-timeout
// safety net abort through job.controller.
function isAbortErr(err) {
    return (
        (err && err.name === 'AbortError') ||
        (err && err.cause && (err.cause.name === 'AbortError' || err.cause.name === 'TimeoutError'))
    )
}

// overleaf-lab: rebuild a best-effort error string from an OError (API message +
// raw body) so parseBackendError's context-overflow detection keeps working against
// provider errors, exactly as it did against raw fetch bodies.
function providerErrorText(err) {
    let apiMessage = ''
    try {
        const info = OError.getFullInfo(err)
        apiMessage =
            (info && info.error && info.error.message) || (info && info.message) || ''
    } catch {
        apiMessage = ''
    }
    const raw = (err && err.cause && (err.cause.body || err.cause.message)) || ''
    return `${apiMessage} ${raw}`.trim()
}

// overleaf-lab: ask the backend for the EXACT token count of the prompt. The
// OpenAI-compatible provider maps this to the llama.cpp /tokenize extension;
// other providers (e.g. Anthropic) have none and report null, which the caller
// treats as "estimate only". Provider-agnostic since PR item 4: the provider
// owns the endpoint shape and the auth header.
//
// Why this matters more than it looks: a character-per-token heuristic can only ever be
// roughly right for LaTeX, whose density varies a lot between prose and math. When it
// errs low the backend rejects the request and tells us the truth, which is recoverable.
// When it errs HIGH we refuse a document that would actually have fit, and nothing
// downstream can correct that: the user is simply blocked. The exact count removes both.
// Returns null for any backend without the exact count, so the caller falls back.
// overleaf-lab: exact token counting. The custom provider factory used to expose
// llama.cpp's /tokenize endpoint; the AI-SDK seam (v6) has no cross-provider exact
// counter, so the conservative estimate (estimateTokens + safety margin) is the
// authoritative budgeting path. Kept as an async function so a backend that DOES
// serve exact counts can plug back in without touching the call sites.
async function countPromptTokens() {
    return null
}
// overleaf-lab: floor for the review timeout (the value it used to be fixed at).
const REVIEW_MIN_TIMEOUT_MS = 60 * 60 * 1000

// overleaf-lab: minimum useful answer room per pass. Below this even a brief verdict
// risks truncation, so the document is refused (too_long) instead of reviewed badly.
const MIN_ANSWER_TOKENS = 2000
// overleaf-lab: margin subtracted from the context headroom to cover what our token
// count cannot see (chat-template role markers, JSON grammar scaffolding).
const CONTEXT_SAFETY_MARGIN = 256

// overleaf-lab: JSON Schema for ONE review pass, enforced by the backend via
// response_format so the model is CONSTRAINED to emit exactly this shape (llama.cpp
// and OpenAI both support json_schema). This removes the "No JSON object found"
// failure class by construction and, because prose is forbidden, also stops a
// reasoning model from spending the whole answer budget on internal thinking.
// "analysis" is deliberately the FIRST property: the grammar enforces field order,
// so the model must write down what it scanned and found BEFORE it commits to a
// verdict (structured look-before-you-judge, with no chat-template thinking needed).
// It is consumed at generation time and dropped from the stored result.
// extractJson below is kept only as a defensive fallback for a backend that ignores
// the field. The other fields mirror what the parser reads (see performReview).
const REVIEW_ITEMS_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: {
        items: {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    analysis: { type: 'string' },
                    requirement: { type: 'string' },
                    status: { type: 'string', enum: ['ok', 'partial', 'missing', 'na'] },
                    evidence: { type: 'string' },
                    suggestion: { type: 'string' },
                },
                required: ['analysis', 'requirement', 'status', 'evidence', 'suggestion'],
            },
        },
    },
    required: ['items'],
}

// overleaf-lab: schema for the final summary synthesis call (items in, 2-4 sentences out).
const REVIEW_SUMMARY_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: { summary: { type: 'string' } },
    required: ['summary'],
}

// overleaf-lab: cap on how many negative findings get an adversarial verification
// pass (each costs one cached-prefill model call; negatives are normally few).
const VERIFY_MAX_FINDINGS = 8

// overleaf-lab: system prompt for the verification pass. Not admin-editable on
// purpose: it is an internal safeguard, not review policy. The reviewer's job is to
// find violations; the verifier's job is to REFUTE them, because a false "missing"
// sends the author hunting for problems that do not exist (observed in practice: a
// quantity flagged as uncited that had its \cite right next to it).
const VERIFY_SYSTEM_PROMPT = `You are adversarially double-checking ONE finding produced by a compliance review of a LaTeX document. The finding either claims a guideline requirement is violated (status "missing" or "partial"), or claims compliance ("ok") but with evidence that a mechanical search flagged as suspect. Your job is to test whether the finding HOLDS UP: a false violation wastes the author's time, and a verdict propped up by fabricated evidence must not survive either.

You receive the DOCUMENT (files marked by "% ===== FILE: <path> =====" headers) and the FINDING as JSON, possibly followed by a NOTE listing how many of its quotes a mechanical search could not find.

For EVERY piece of quoted evidence in the finding, check in the DOCUMENT:
1. Does the quoted text actually appear (verbatim or nearly)?
2. Does it actually support the verdict in context? For a missing-citation claim, read the full sentence and its neighbours: a \\cite nearby refutes it. For an unsupported-qualitative-claim finding, numbers or a citation in the surrounding text refute it. For an "ok" finding, replace unfounded evidence with REAL evidence from the document, or downgrade the status if you cannot find any.

Then return ONE corrected item: keep only the claims that survive your check and drop the refuted ones from the evidence. If nothing of a violation survives, set status "ok" and let the evidence say the original finding did not hold up. If only part survives, choose "partial" or "missing" accordingly. Keep the evidence under about 500 characters. Use the same language as the finding.

Return ONLY a JSON object, with no preamble and no code fences, in exactly this shape:
{"items":[{"analysis":"what you re-checked and what you found","requirement":"the requirement, unchanged","status":"ok","evidence":"the surviving violations, or why the finding was rejected","suggestion":"a concrete suggestion (empty string when status is ok)"}]}`

// overleaf-lab: deterministic scan hints, computed mechanically from the stripped
// source and appended to the document in every pass. An LLM attends over the whole
// prompt, but a single forward pass cannot be TRUSTED to have checked every line for
// an absence claim: in practice it asserts the absence and quotes a few well-behaved
// examples. Greppable patterns are therefore scanned in code (exhaustive by
// construction) and the model receives ground truth: counts it can rely on, and
// candidate violations it must judge in context.
//
// The BUILT-INS are only language- and policy-neutral LaTeX structure counts. All
// content patterns (words to avoid, first-person forms, forbidden sources...) are
// policy, and policy belongs to the RUBRIC being checked, not to this file: they
// come in via the rubric's own "scan patterns" field (see parseScanPatterns). Those
// patterns may over-capture freely; context judgement is the model's half of the
// bargain, exhaustiveness is ours.
function buildScanHints(strippedDocs, customPatterns = []) {
    const count = re =>
        strippedDocs.reduce((n, d) => n + (d.text.match(re) || []).length, 0)
    const collect = (re, cap) => {
        const hits = []
        for (const d of strippedDocs) {
            for (const line of d.text.split('\n')) {
                if (hits.length >= cap) {
                    return hits
                }
                if (re.test(line)) {
                    hits.push(`${d.path}: "${line.trim().slice(0, 120)}"`)
                }
            }
        }
        return hits
    }

    const figures = count(/\\begin\{figure/g)
    const tables = count(/\\begin\{(?:table|longtable)/g)
    const captions = count(/\\caption/g)
    const equations = count(/\\begin\{(?:equation|align|gather|multline)/g)
    const refs = count(/\\ref\{/g)
    const cites = count(/\\cite\{/g)
    const listings = count(/\\begin\{(?:lstlisting|verbatim)/g)

    const fmt = (label, hits) =>
        hits.length === 0
            ? `- ${label}: none found (mechanically verified over the whole source)`
            : `- ${label} (${hits.length} candidate${
                  hits.length === 1 ? '' : 's'
              }, judge each in context): ${hits.join(' | ')}`

    const lines = [
        'SCAN HINTS (computed mechanically from the LaTeX source; exhaustive for the listed patterns):',
        `- Counts: ${figures} figure environments, ${tables} table environments, ${captions} \\caption, ${equations} equation environments, ${refs} \\ref, ${cites} \\cite, ${listings} code listing environments.`,
    ]
    // overleaf-lab: rubric-defined scans (see parseScanPatterns): exhaustive scan by
    // code, context judgement by the model.
    for (const { label, regex } of customPatterns) {
        lines.push(fmt(label, collect(regex, 15)))
    }
    return lines.join('\n')
}

// overleaf-lab: parse a RUBRIC's scan patterns (each rubric carries its own, edited
// next to its guidelines in the settings page, so the patterns live and die with the
// policy that motivates them). One per line, "Label :: regex" (case-insensitive); a
// line without "::" is used as both label and pattern, so a plain word works as-is.
// The save endpoint already refuses invalid regexes, but settings written by other
// means must not break a review, so invalid lines are skipped here too. Capped to
// keep the hint block small.
/*
 * F5: ReDoS guard for admin-authored rubric regexes. These patterns run over
 * document text, so a catastrophic pattern (nested quantifiers such as (a+)+,
 * recursive groups) could hang a review. Heuristic: reject recursive-group
 * syntax and any group containing a quantifier that is itself quantified.
 * Patterns that fail are skipped (with a debug log), never fatal.
 */
function containsNestedQuantifier(pattern) {
    for (let i = 0; i < pattern.length; i++) {
        if (pattern[i] !== '(' || pattern[i - 1] === '\\') continue
        let depth = 1
        let inner = false
        let close = -1
        for (let j = i + 1; j < pattern.length; j++) {
            if (pattern[j - 1] === '\\') continue
            const c = pattern[j]
            if (c === '(') depth++
            else if (c === ')') {
                depth--
                if (depth === 0) {
                    close = j
                    break
                }
            }
            else if (depth === 1 && (c === '+' || c === '*' || c === '{')) {
                inner = true
            }
        }
        if (close !== -1 && inner && /^\s*(?:\+|\*|\{)/.test(pattern.slice(close + 1))) {
            return true
        }
        if (close !== -1) i = close // continue after this group
    }
    return false
}

function safeRubricRegex(pattern) {
    if (typeof pattern !== 'string' || !pattern || pattern.length > 300) return null
    if (/\(?\?R|\(?\?&/.test(pattern)) return null // recursive groups
    if (containsNestedQuantifier(pattern)) return null
    try {
        return new RegExp(pattern, 'i')
    }
    catch {
        return null
    }
}

function parseScanPatterns(text) {
    const patterns = []
    for (const rawLine of String(text || '').split('\n')) {
        if (patterns.length >= 20) {
            break
        }
        const line = rawLine.trim()
        if (!line) {
            continue
        }
        const sep = line.indexOf('::')
        const label = (sep === -1 ? line : line.slice(0, sep)).trim()
        const body = (sep === -1 ? line : line.slice(sep + 2)).trim()
        if (!body) {
            continue
        }
        try {
            const regex = safeRubricRegex(body)
            if (regex) {
                patterns.push({ label: label || body, regex })
            }
            else {
                logger.debug({ line }, '[LLM] compliance: skipping unsafe/invalid scan pattern')
            }
        }
        catch (err) {
            logger.debug({ line, err: err?.message }, '[LLM] compliance: skipping invalid scan pattern')
        }
    }
    return patterns
}

// overleaf-lab: quote grounding. The judge itself can hallucinate evidence (observed:
// invented line numbers, quotes attributed to the wrong file), which is the failure
// mode that costs a report its credibility. Quotes are mechanically checkable: every
// quoted passage in an item's evidence is searched (whitespace/typography-normalized)
// in the assembled source. Ungrounded quotes flag the item for adversarial
// verification and, if they survive, a visible warning is appended to the evidence.
function normalizeForMatch(text) {
    return String(text || '')
        .replace(/[‘’‚]/g, "'")
        .replace(/[“”„«»]/g, '"')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase()
}

// overleaf-lab: pull the quoted passages out of an evidence string. Handles double
// quotes and guillemets anywhere, and single-quoted spans only when they close a
// chunk (Italian apostrophes make mid-chunk single quotes ambiguous). Short spans are
// ignored: grounding a 5-char quote proves nothing. Missing a quote here is harmless
// (it just goes unchecked); a false extraction could produce a false warning, so the
// rules stay conservative.
function extractQuotedSegments(evidence) {
    const segments = []
    // Typographic quotes/guillemets fold onto their straight forms FIRST, so the
    // extraction rules below see one quoting style regardless of what the model used.
    const text = String(evidence || '')
        .replace(/[“”„«»]/g, '"')
        .replace(/[‘’‚]/g, "'")
    for (const match of text.matchAll(/"([^"]{15,300})"/g)) {
        segments.push(match[1])
    }
    for (const chunk of text.split('|')) {
        const single = /'(.{15,300})'\s*$/.exec(chunk.trim())
        if (single) {
            segments.push(single[1])
        }
    }
    return segments
}

// overleaf-lab: models legitimately compress long quotes with internal ellipses
// ("first words ... last words"). The literal segment then never matches the source,
// which used to fire the ungrounded-quote warning on honest evidence. Each segment is
// split on its ellipses and every piece long enough to be probative is searched on
// its own; pieces too short to prove anything are dropped.
function splitOnEllipses(segment) {
    return String(segment)
        .split(/\[\s*\.{3,}\s*\]|\.{3,}|…/)
        .map(p => p.trim())
        .filter(p => p.length >= 15)
}

// overleaf-lab: how many quoted passages of this evidence do NOT appear in the
// normalized source. {checked: n, missing: m}; checked=0 means the evidence carries
// no groundable quotes (e.g. a scan description), which is fine. A segment counts as
// missing only if one of its probative pieces is absent from the source.
function countUngroundedQuotes(evidence, normalizedSource) {
    let checked = 0
    let missing = 0
    for (const segment of extractQuotedSegments(evidence)) {
        const pieces = splitOnEllipses(segment)
        if (pieces.length === 0) {
            continue
        }
        checked += 1
        if (pieces.some(p => !normalizedSource.includes(normalizeForMatch(p)))) {
            missing += 1
        }
    }
    return { checked, missing }
}

// overleaf-lab: repair LaTeX commands mangled by JSON string escapes. The JSON
// grammar cannot admit invalid escapes, so a model writing \ref unescaped ends up
// emitting the legal escape "\r" plus "ef", which parses to a control character and
// renders as "ef{...}" in the report (observed with two different models). CR, BS,
// FF and VT directly before a letter can only be that artifact and are always
// restored; LF and TAB can be legitimate whitespace, so they are restored only in
// front of common LaTeX command stems.
function repairJsonEscapeArtifacts(text) {
    return String(text || '')
        .replace(/\r(?=[A-Za-z])/g, '\\r')
        .replace(/[\b](?=[A-Za-z])/g, '\\b')
        .replace(/\f(?=[A-Za-z])/g, '\\f')
        .replace(/\v(?=[A-Za-z])/g, '\\v')
        .replace(/\n(?=ewcommand|ewline|ewpage|abla|onumber)/g, '\\n')
        .replace(/\t(?=ext|imes|heta|itle|oday)/g, '\\t')
}

// overleaf-lab: the "[per-file]" rubric marker. A requirement about diffuse text
// quality (spelling, tense coherence) checked in ONE pass over a whole thesis falls
// into the documented lost-in-the-middle failure: the model under-attends the middle
// of a long context and an "ok" under-covers the central chapters. Ending a rubric
// line with [per-file] makes that requirement run as one sub-pass per source file
// (each file alone in context, fully attended), merged into a single report item.
// Like the scan patterns, the marker lives in the rubric: policy, not code.
const PER_FILE_MARKER = /\s*\[\s*per[- ]file\s*\]\s*$/i

function isPerFileRequirement(requirement) {
    return PER_FILE_MARKER.test(requirement)
}

function stripPerFileMarker(requirement) {
    return String(requirement || '').replace(PER_FILE_MARKER, '').trim()
}

// overleaf-lab: fold the per-file sub-results into ONE report item. Any missing wins,
// else any partial, else ok; "na" files (a spelling check on a .bib is legitimately
// n.a.) do not drag the verdict down unless nothing was checkable at all.
function mergeFileItems(requirement, fileResults) {
    const statuses = fileResults.map(r => r.status)
    let status = 'na'
    if (statuses.includes('missing')) {
        status = 'missing'
    } else if (statuses.includes('partial')) {
        status = 'partial'
    } else if (statuses.includes('ok')) {
        status = 'ok'
    }
    let evidence
    if (status === 'ok') {
        const okCount = statuses.filter(s => s === 'ok').length
        const naCount = statuses.filter(s => s === 'na').length
        evidence = `Checked file by file: ${okCount}/${fileResults.length} files ok${
            naCount > 0 ? `, ${naCount} n.a.` : ''
        }`
    } else {
        evidence = fileResults
            .filter(r => r.status === status)
            .slice(0, 5)
            .map(r => `${r.path}: ${r.evidence}`)
            .join(' | ')
            .slice(0, 600)
    }
    const suggestion =
        (fileResults.find(r => r.status === status && r.suggestion) || {}).suggestion || ''
    return {
        requirement,
        status,
        evidence,
        suggestion: String(suggestion).slice(0, 600),
    }
}

// overleaf-lab: split the rubric guidelines into individually checkable requirements,
// one model pass each. Rule (documented in the admin UI): one requirement per numbered
// line ("1.", "2)", ...); continuation lines belong to the requirement above; text
// before the first numbered line is a preamble repeated in every pass as context.
// Bulleted lines ("-", "*", "•") split too, but only when there are no numbered lines,
// so sub-bullets inside numbered requirements do not fragment them. A rubric with no
// recognizable structure degrades gracefully to today's single pass over the whole
// text, never to an arbitrary split.
function splitRubric(text) {
    const raw = String(text || '')
    const NUMBERED = /^\s*\d{1,3}[.)]\s+/
    const BULLET = /^\s*[-*•]\s+/
    const lines = raw.split('\n')
    const numberedCount = lines.filter(l => NUMBERED.test(l)).length
    const marker = numberedCount >= 2 ? NUMBERED : BULLET
    const requirements = []
    const preambleLines = []
    let current = null
    for (const line of lines) {
        if (marker.test(line)) {
            if (current) {
                requirements.push(current.join('\n').trim())
            }
            current = [line.trim()]
        } else if (current) {
            current.push(line)
        } else {
            preambleLines.push(line)
        }
    }
    if (current) {
        requirements.push(current.join('\n').trim())
    }
    if (requirements.length < 2) {
        return { preamble: '', requirements: [raw.trim()] }
    }
    return { preamble: preambleLines.join('\n').trim(), requirements }
}
// overleaf-lab: strip LaTeX line comments to save tokens. For each line, cut from
// the first unescaped `%` (a `%` not preceded by a backslash) to end of line, while
// keeping escaped `\%`. This is simple and conservative: it can over-strip inside
// verbatim environments, which is acceptable for a compliance review that only
// needs the prose/content, not byte-exact source.
function stripLatexComments(text) {
    return text
        .split('\n')
        .map(line => {
            let result = ''
            for (let i = 0; i < line.length; i++) {
                const ch = line[i]
                if (ch === '%' && (i === 0 || line[i - 1] !== '\\')) {
                    break
                }
                result += ch
            }
            return result
        })
        .join('\n')
}

// overleaf-lab: characters per token for the FALLBACK size estimate, used only when the
// backend has no /tokenize (countPromptTokens is the normal path and is exact). The
// usual "4 chars per token" rule is calibrated on English prose; measured on a real
// LaTeX thesis the ratio was about 3.4, so 4 is optimistic. We use a slightly
// conservative 3.0: close enough not to refuse documents that would fit, low enough to
// still catch a gross overflow. An earlier 2.5 was too pessimistic and blocked a
// document that actually fitted, which is the worse failure since nothing downstream
// can correct a false refusal.
const REVIEW_CHARS_PER_TOKEN =
    Number.parseFloat(process.env.LLM_REVIEW_CHARS_PER_TOKEN) > 0
        ? Number.parseFloat(process.env.LLM_REVIEW_CHARS_PER_TOKEN)
        : 3.0

// overleaf-lab: rough token estimate used only to keep a single-pass review within
// the configured context window (and to size the progress estimate).
function estimateTokens(text) {
    return Math.ceil(String(text || '').length / REVIEW_CHARS_PER_TOKEN)
}

// overleaf-lab: first regex that matches wins; returns null when none does.
function firstNumber(text, patterns) {
    for (const pattern of patterns) {
        const match = pattern.exec(text)
        if (match) {
            const value = Number.parseInt(match[1], 10)
            if (Number.isFinite(value) && value > 0) {
                return value
            }
        }
    }
    return null
}

// overleaf-lab: turn a backend error body into something we can show the user. A
// context overflow is the common, actionable case: both llama.cpp and OpenAI report
// the prompt size and the context limit in the message, which is exactly what the user
// needs to decide between shortening the document and raising the context window.
// Returns { message, isContext, promptTokens, contextTokens }.
function parseBackendError(errorText) {
    let message = String(errorText || '').trim()
    let kind = ''
    try {
        const body = JSON.parse(errorText)
        const err = body && body.error
        if (err) {
            message = String(err.message || message)
            // Both fields matter: OpenAI puts 'invalid_request_error' in `type` and
            // the useful 'context_length_exceeded' in `code`, so picking only one
            // would miss the overflow.
            kind = `${err.type || ''} ${err.code || ''}`.trim()
        }
    } catch (e) {
        // Not JSON: keep the raw text as the message.
    }

    const haystack = `${kind} ${message}`.toLowerCase()
    const isContext =
        haystack.includes('exceed_context_size') ||
        haystack.includes('context_length_exceeded') ||
        haystack.includes('maximum context') ||
        haystack.includes('context window') ||
        (haystack.includes('context') &&
            (haystack.includes('exceed') ||
                haystack.includes('too long') ||
                haystack.includes('larger than')))

    const promptTokens = firstNumber(message, [
        /n_prompt_tokens\s*=\s*(\d+)/i,
        /you requested\s+(\d+)\s+tokens/i,
        /requested\s+(\d+)\s+tokens/i,
    ])
    const contextTokens = firstNumber(message, [
        /n_ctx\s*=\s*(\d+)/i,
        /maximum context length is\s+(\d+)/i,
        /context (?:size|length)[^0-9]{0,24}(\d+)/i,
    ])

    return { message, isContext, promptTokens, contextTokens }
}

// overleaf-lab: extract a JSON object from a model reply that may include code
// fences or surrounding prose. Strip fences, then take the substring from the first
// `{` to the last `}` and parse it. Throws when no valid JSON is found.
function extractJson(text) {
    let cleaned = String(text || '').trim()
    cleaned = cleaned
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/```\s*$/i, '')
// Fricking vim makes the rest of the file red without this `
    const first = cleaned.indexOf('{')
    const last = cleaned.lastIndexOf('}')
    if (first === -1 || last === -1 || last < first) {
        throw new Error('No JSON object found in model output')
    }
    return JSON.parse(cleaned.slice(first, last + 1))
}

// overleaf-lab: unique id for a review job. Date.now/Math.random are fine here,
// this is normal Node code (not a security token).
// overleaf-lab (audit M2): jobs still queued/running belong to a dead process
// (single worker) — mark them failed so clients get a definitive answer instead
// of the pre-M2 "not found or expired". Cheap and idempotent; runs once per
// process, lazily, on the first request after a restart.
let sweepDone = false
async function sweepStuckJobsOnce() {
    if (sweepDone) {
        return
    }
    sweepDone = true
    await persistStuckJobs()
}
function newJobId() {
    return `job-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

// overleaf-lab: drop finished jobs (done/error/cancelled) that are older than the
// TTL, so the map does not grow unbounded across a long-lived process.
function sweepOldJobs() {
    const now = Date.now()
    for (const [id, job] of jobs) {
        const finished =
            job.status === 'done' ||
            job.status === 'error' ||
            job.status === 'cancelled'
        if (finished && job.finishedAt != null && now - job.finishedAt > JOB_TTL_MS) {
            jobs.delete(id)
        }
    }
}

// overleaf-lab: how many reviews are ahead of this job: the running one (if any)
// plus the queued jobs before it. A job that is not in the queue (running, about
// to run, or finished) has nothing ahead, so return 0.
function jobsAhead(jobId) {
    const idx = queue.indexOf(jobId)
    if (idx === -1) {
        return 0
    }
    return idx + (running ? 1 : 0)
}

// overleaf-lab: run the actual review work for one job. Returns a discriminated
// outcome: { type: 'done', result } on success, or { type: 'error', errorCode,
// message, ... } for a logical failure (too_long / model_unavailable /
// empty_document). Throws on an HTTP/parse failure or an abort (cancel or the
// review timeout); processQueue maps those to the 'cancelled' or 'failed' state.
async function performReview(job) {
    currentUsageMeta = {
        userId: job.userId,
        action: 'review',
        lane: job.modelOverride && String(job.modelOverride).startsWith('u:') ? 'user' : 'site',
        projectId: job.projectId,
    } // overleaf-lab (usage meter)
    const { projectId, userId } = job

    // overleaf-lab: resolve the rubric fresh at run time (the job only stores id and
    // name) so the guidelines text is current when the job finally runs.
    // overleaf-lab (2026-08-27): from the USER's rubric set (own or inherited).
    const rubrics = await getComplianceRubricsForUser(userId)
    const rubric = rubrics.find(r => r.id === job.rubricId)
    if (!rubric) {
        throw new Error('Rubric is no longer available')
    }

    // overleaf-lab (2026-08-27): the ONE shared model resolution — explicit
    // job override > user's profile selection > first BYO row > site backend.
    // The former admin "Review model" and the not_configured URL check are gone:
    // a deployment without a global LLM works through the same lane chain.
    const admin = await getAdminLLMSettings()
    // overleaf-lab (2026-11): the Review task slot (per-task model selection).
    const resolved = await resolveModelLane(userId, job.modelOverride || undefined, 'review').catch(err => {
        throw Object.assign(
            new Error(err?.message || 'No usable LLM backend is configured'),
            { code: 'model-unavailable' },
        )
    })
    currentBaseSpec = resolved.spec
    const reviewModel = resolved.model
    // overleaf-lab: deployment context budgets (admin-configured, with safe
    // defaults) — unchanged by the per-user migration.
    const maxContextTokens = admin.maxContextTokens || 32000
    // overleaf-lab: the admin-set answer budget; the effective room adapts to
    // what the document leaves free inside maxContextTokens.
    const reviewMaxTokens = admin.reviewMaxTokens || REVIEW_MAX_TOKENS

    // overleaf-lab: resolve the effective editable prompts (admin override or the
    // shipped default) so the review uses the admin-tuned system prompt.
    const prompts = await getLLMPrompts()

    // Assemble the whole project into one LaTeX blob.
    const docsByPath = await ProjectEntityHandler.promises.getAllDocs(projectId)
    const docs = []
    for (const [docPath, value] of Object.entries(docsByPath || {})) {
        // overleaf-lab: getAllDocs is keyed by doc path; each value has a `lines`
        // array of strings. Be defensive: a value may be null.
        if (!value) {
            continue
        }
        const text = (value.lines || []).join('\n')
        if (!text.trim()) {
            continue
        }
        docs.push({ path: docPath, text })
    }

    // overleaf-lab: put the main file (the one containing \documentclass) first,
    // then the remaining docs sorted by path for a stable order.
    docs.sort((a, b) => {
        const aMain = a.text.includes('\\documentclass')
        const bMain = b.text.includes('\\documentclass')
        if (aMain && !bMain) {
            return -1
        }
        if (!aMain && bMain) {
            return 1
        }
        return a.path.localeCompare(b.path)
    })

    // overleaf-lab: strip LaTeX comments per source doc BEFORE prefixing the FILE
    // header, so the header lines (which themselves start with `%`) survive. Keep the
    // stripped per-file texts: the deterministic scan hints are computed on exactly
    // what the model will see.
    const strippedDocs = docs.map(d => ({
        path: d.path,
        text: stripLatexComments(d.text),
    }))
    const parts = strippedDocs.map(d => `% ===== FILE: ${d.path} =====\n${d.text}`)
    const assembled = parts.join('\n\n')
    const scanHints = buildScanHints(strippedDocs, parseScanPatterns(rubric.scanPatterns))

    if (!assembled.trim()) {
        return {
            type: 'error',
            errorCode: 'empty_document',
            message: 'The project has no text to review',
        }
    }

    // overleaf-lab: split the rubric into one requirement per pass (numbered/bulleted
    // lines; prose degrades to a single pass over the whole text). Resolved fresh per
    // job, so editing the rubric in the admin UI changes the NEXT review's pass count.
    const { preamble, requirements } = splitRubric(rubric.guidelines)

    // Context-window guard. Budget the WHOLE prompt against the configured context
    // window: document + rubric guidelines + system prompt + room for the JSON
    // answer. The rubric can be large, so it must count too, otherwise the document
    // could pass here and the full prompt still overflow. Counting ALL the guidelines
    // is a safe upper bound: each pass actually sends only one requirement.
    // overleaf-lab: prefer the backend's exact count; fall back to the heuristic when
    // it has no /tokenize (see countPromptTokens).
    const heuristicPromptTokens =
        estimateTokens(assembled) +
        estimateTokens(scanHints) +
        estimateTokens(rubric.guidelines) +
        estimateTokens(prompts.reviewSystemPrompt)
    const exactPromptTokens = await countPromptTokens()
    const promptTokens = exactPromptTokens || heuristicPromptTokens
    logger.debug(
        { projectId, promptTokens, exact: exactPromptTokens != null, heuristicPromptTokens },
        '[LLM] compliance: prompt size'
    )
    // overleaf-lab: expose the size for the result metadata and error reports.
    job.documentTokensEstimate = promptTokens

    // overleaf-lab: ADAPTIVE per-pass answer budget. max_tokens is a CAP, not a
    // target: a short answer costs the same under any cap, so the only real cost of a
    // generous budget is the context room it reserves. Give each pass ALL the room the
    // document leaves free (up to the admin budget) instead of a fixed slice: a
    // thorough pass may legitimately enumerate dozens of figures in its analysis, and
    // writing that enumeration out IS how the model verifies (starving it pushes the
    // work back into attention, which is what multi-pass exists to avoid).
    const headroom = maxContextTokens - promptTokens - CONTEXT_SAFETY_MARGIN
    const perPassBudget = Math.min(reviewMaxTokens, headroom)
    if (perPassBudget < MIN_ANSWER_TOKENS) {
        // overleaf-lab: report the minimum reserve too. Without it the UI could only
        // show "prompt / limit", which can look like it fits while the refusal is
        // really caused by the answer room pushing the total over.
        return {
            type: 'error',
            errorCode: 'too_long',
            message:
                'Document is too long for a single-pass review with the configured context window',
            documentTokensEstimate: promptTokens,
            maxContextTokens,
            reviewMaxTokens: MIN_ANSWER_TOKENS,
        }
    }

    // Reachability check: only when an explicit review model is configured.
    // overleaf-lab: verify the configured model is actually served by the backend.
    // If the /models call itself fails, log and continue; the chat call below will
    // surface any real error.
    if (typeof admin.reviewModel === 'string' && admin.reviewModel.trim().length > 0) {
        try {
            // overleaf-lab: provider-agnostic model preflight (PR item 4) — same list
            // API as the admin model scan; the provider owns path + auth.
            const { ids } = await listModelsSdk(specFor(reviewModel), { timeoutMs: 60000 })
            if (!ids.includes(reviewModel)) {
                return {
                    type: 'error',
                    errorCode: 'model_unavailable',
                    message: 'The configured review model is not available on the backend',
                }
            }
        } catch (err) {
            logger.warn({ projectId, err }, '[LLM] compliance: /models check failed, continuing')
        }
    }

    // Build the per-pass request pieces. The document comes FIRST in the user message
    // so the llama.cpp prompt cache can reuse its prefill across passes: with the
    // requirement appended AFTER the document, passes 2..N only pay for their own few
    // hundred tokens instead of re-reading the whole project. The scan hints are
    // constant per job, so they live in the shared cached prefix too.
    const documentBlock = `DOCUMENT:\n${assembled}\n\n${scanHints}\n\n`
    const guidelinesFor = requirement =>
        `GUIDELINES (check ONLY these):\n${preamble ? `${preamble}\n` : ''}${requirement}`

    // overleaf-lab: auth is the provider's job now (OpenAI-compatible Bearer or
    // Anthropic x-api-key, sent only when a key exists).

    // overleaf-lab: per-pass safety timeout, SIZED FROM THE WORK with the old fixed
    // hour as the floor. The worst case per pass is a full document prefill (the
    // prompt cache makes later passes much cheaper, but a cap must not rely on that)
    // plus a full-budget generation. These fetches do not pass through nginx (the
    // client polls the job), so no proxy limit applies. Recomputed every pass, since
    // timings from completed passes refine the measured rates.
    const passTimeoutMs = () => {
        const rates = effectiveRates()
        const worstCaseMs =
            Math.round((promptTokens / rates.prefillTps) * 1000) +
            Math.round((perPassBudget / rates.genTps) * 1000)
        return Math.max(REVIEW_MIN_TIMEOUT_MS, Math.round(worstCaseMs * 1.5))
    }

    // overleaf-lab: pass-based progress, read by the status endpoint. A [per-file]
    // requirement counts one pass per source file.
    let mainPassCount = requirements.reduce(
        (n, r) =>
            n + (isPerFileRequirement(r) && strippedDocs.length > 1 ? strippedDocs.length : 1),
        0
    )
    // overleaf-lab: F6 — hard cap on passes per job. [per-file] requirements on a
    // 100-file project would otherwise multiply passes (and cost) by 100x.
    if (mainPassCount > MAX_PASSES_PER_JOB) {
        logger.warn(
            { projectId, requested: mainPassCount, cap: MAX_PASSES_PER_JOB },
            '[LLM] compliance: pass cap applied'
        )
        mainPassCount = MAX_PASSES_PER_JOB
    }
    job.passesTotal = mainPassCount
    job.passesDone = 0
    let completedPasses = 0

    // overleaf-lab: normalized source for the mechanical quote-grounding check.
    const normalizedSource = normalizeForMatch(assembled)

    const allItems = []
    for (let i = 0; i < requirements.length; i++) {
        // A cancel can land BETWEEN passes; stop before spending another model call
        // (an in-flight fetch is aborted by the shared controller signal instead).
        if (job.status === 'cancelled') {
            throw new Error('review cancelled between passes')
        }
        const perFile = isPerFileRequirement(requirements[i]) && strippedDocs.length > 1
        const requirement = stripPerFileMarker(requirements[i])
        // overleaf-lab: F6 — hard stop at the configured pass budget. This and
        // every remaining requirement are reported as 'skipped' below so the
        // report stays complete and honest about coverage.
        const passCost = perFile ? strippedDocs.length : 1
        if (completedPasses + passCost > MAX_PASSES_PER_JOB) {
            for (let k = i; k < requirements.length; k++) {
                allItems.push({
                    requirement: stripPerFileMarker(requirements[k]),
                    status: 'skipped',
                    evidence: `Pass budget reached (${MAX_PASSES_PER_JOB} passes; see LLM_REVIEW_MAX_PASSES)`,
                    suggestion: '',
                })
            }
            break
        }
        job.passesDone = completedPasses
        job.currentRequirement = requirement.replace(/\s+/g, ' ').slice(0, 160)

        // overleaf-lab: [per-file] branch. One sub-pass per source file, each with
        // ONLY that file in context (fully attended, no lost-in-the-middle), merged
        // into a single report item. This deliberately gives up the shared document
        // cache prefix: the sub-pass prompts are small, so the total prefill is about
        // one extra read of the project. Lean by design: no retry (small prompts do
        // not truncate), a failed file becomes "n.a." for that file only.
        if (perFile) {
            const fileResults = []
            for (let f = 0; f < strippedDocs.length; f++) {
                if (job.status === 'cancelled') {
                    throw new Error('review cancelled between passes')
                }
                const doc = strippedDocs[f]
                job.currentRequirement = `${requirement} (file ${f + 1}/${strippedDocs.length}: ${doc.path})`
                    .replace(/\s+/g, ' ')
                    .slice(0, 160)
                const subBody = {
                    model: reviewModel,
                    messages: [
                        { role: 'system', content: prompts.reviewSystemPrompt },
                        {
                            role: 'user',
                            content:
                                `DOCUMENT (one file of a larger project):\n% ===== FILE: ${doc.path} =====\n${doc.text}\n\n` +
                                `GUIDELINES (check ONLY these, in THIS file only):\n${
                                    preamble ? `${preamble}\n` : ''
                                }${requirement}`,
                        },
                    ],
                    max_tokens: perPassBudget,
                    temperature: 0,
                    response_format: {
                        type: 'json_schema',
                        json_schema: {
                            name: 'compliance_review',
                            strict: true,
                            schema: REVIEW_ITEMS_SCHEMA,
                        },
                    },
                }
                const subTimeout = setTimeout(() => {
                    if (job.controller) {
                        job.controller.abort()
                    }
                }, passTimeoutMs())
                try {
                    // overleaf-lab: PR item 4 — provider call; a refusal now throws
                    // (OError) instead of returning a non-ok Response.
                    let detailed = null
                    try {
                        detailed = await llmChat(subBody, {
                            signal: job.controller ? job.controller.signal : undefined,
                        })
                    } catch (err) {
                        if (job.status === 'cancelled' || isAbortErr(err)) {
                            throw err
                        }
                        const backendError = parseBackendError(providerErrorText(err))
                        fileResults.push({
                            path: doc.path,
                            status: 'na',
                            evidence: backendError.message
                                ? `check refused: ${backendError.message.slice(0, 200)}`
                                : `check refused (${err.message})`,
                            suggestion: '',
                        })
                    }
                    if (detailed) {
                        const data = detailed.raw
                        recordTimings(data && data.timings)
                        const content = detailed.content
                        try {
                            const parsed = extractJson(content)
                            const first = Array.isArray(parsed.items) ? parsed.items[0] : null
                            fileResults.push({
                                path: doc.path,
                                status:
                                    first &&
                                    ['ok', 'partial', 'missing', 'na'].includes(first.status)
                                        ? first.status
                                        : 'na',
                                evidence: repairJsonEscapeArtifacts(
                                    (first && first.evidence) || ''
                                ).slice(0, 300),
                                suggestion: repairJsonEscapeArtifacts(
                                    (first && first.suggestion) || ''
                                ).slice(0, 300),
                            })
                        } catch (err) {
                            fileResults.push({
                                path: doc.path,
                                status: 'na',
                                evidence: 'unparseable answer for this file',
                                suggestion: '',
                            })
                        }
                    }
                } catch (err) {
                    if (job.status === 'cancelled' || isAbortErr(err)) {
                        throw err
                    }
                    logger.warn(
                        { projectId, pass: i, file: doc.path, err },
                        '[LLM] compliance: per-file sub-pass failed'
                    )
                    fileResults.push({
                        path: doc.path,
                        status: 'na',
                        evidence: `check failed (${err.message})`,
                        suggestion: '',
                    })
                } finally {
                    clearTimeout(subTimeout)
                }
                completedPasses += 1
                job.passesDone = completedPasses
            }
            allItems.push(mergeFileItems(requirement, fileResults))
            continue
        }

        const requestBody = {
            model: reviewModel,
            messages: [
                { role: 'system', content: prompts.reviewSystemPrompt },
                { role: 'user', content: documentBlock + guidelinesFor(requirement) },
            ],
            max_tokens: perPassBudget,
            // overleaf-lab: greedy decoding, so re-running the review on an unchanged
            // document yields stable verdicts. A compliance report that flips between
            // runs (observed at 0.2: the same requirement went missing -> ok with no
            // document change) reads as a lottery to the person fixing the document.
            temperature: 0,
            // overleaf-lab: constrain the answer to the per-pass JSON shape (see
            // REVIEW_ITEMS_SCHEMA). Guarantees parseable output and, because prose is
            // forbidden, prevents a reasoning model from burning the budget on
            // thinking. enable_thinking:false for a local reasoning model is handled
            // at the router (llama-only), not here, staying portable to cloud backends.
            response_format: {
                type: 'json_schema',
                json_schema: {
                    name: 'compliance_review',
                    strict: true,
                    schema: REVIEW_ITEMS_SCHEMA,
                },
            },
        }

        const timeout = setTimeout(() => {
            if (job.controller) {
                job.controller.abort()
            }
        }, passTimeoutMs())
        try {
            // overleaf-lab: PR item 4 — provider call; a non-ok response now
            // SURFACES AS A THROW, so the refusal handling moved into the inner
            // catch (same semantics: context overflow fails the job, anything
            // else downgrades this requirement).
            let data
            let content
            try {
                const detailed = await llmChat(requestBody, {
                    signal: job.controller ? job.controller.signal : undefined,
                })
                data = detailed.raw
                content = detailed.content
            } catch (err) {
                if (job.status === 'cancelled' || isAbortErr(err)) {
                    throw err
                }
                logger.error({ projectId, userId, pass: i, err }, '[LLM] compliance: LLM API error')
                const backendError = parseBackendError(providerErrorText(err))

                // overleaf-lab: a context overflow means the DOCUMENT does not fit, so
                // every other pass would fail identically: fail the whole job, with the
                // backend's real numbers (they beat our own estimate).
                if (backendError.isContext) {
                    return {
                        type: 'error',
                        errorCode: 'too_long',
                        message:
                            'The document is too long for the review model context window',
                        documentTokensEstimate:
                            backendError.promptTokens || promptTokens,
                        maxContextTokens:
                            backendError.contextTokens || maxContextTokens,
                        reviewMaxTokens: perPassBudget,
                    }
                }

                // Any other refusal: record THIS requirement as unverifiable and move
                // on, so one bad pass no longer kills the other N-1.
                allItems.push({
                    requirement: job.currentRequirement,
                    status: 'na',
                    evidence: backendError.message
                        ? `The check could not run: ${backendError.message.slice(0, 200)}`
                        : `The check could not run: ${err.message}`,
                    suggestion: '',
                })
                continue
            }

            // overleaf-lab: a full-size prefill is the best throughput measurement
            // there is; cache-hit passes are rejected by the sample-size gate.
            recordTimings(data && data.timings)

            // overleaf-lab: parse, with ONE retry on an unusable answer. The typical
            // cause is a broad requirement (e.g. "check every citation") whose analysis
            // enumeration blows the per-pass budget: the grammar-constrained JSON gets
            // cut mid-way (finish_reason 'length') and cannot be parsed. The retry adds
            // an explicit brevity instruction; thanks to the prompt cache it only pays
            // its own generation, not another document prefill.
            let parsed = null
            for (let attempt = 0; attempt < 2 && parsed === null; attempt++) {
                if (attempt === 1) {
                    logger.warn(
                        {
                            projectId,
                            pass: i,
                            truncated: data?.choices?.[0]?.finish_reason === 'length',
                        },
                        '[LLM] compliance: pass answer unusable, retrying with brevity note'
                    )
                    const retryBody = {
                        ...requestBody,
                        messages: [
                            {
                                role: 'system',
                                content: `${prompts.reviewSystemPrompt}\n\nIMPORTANT: your previous answer was unusable (likely cut off by the token budget). Be drastically more concise: keep "analysis" under 80 words, report counts instead of lists, and quote at most three short examples in "evidence".`,
                            },
                            requestBody.messages[1],
                        ],
                    }
                    let retryD
                    let retryOk = false
                    try {
                        retryD = await llmChat(retryBody, {
                            signal: job.controller ? job.controller.signal : undefined,
                        })
                        retryOk = true
                    } catch (rerr) {
                        if (job.status === 'cancelled' || isAbortErr(rerr)) {
                            throw rerr
                        }
                        logger.warn(
                            { projectId, pass: i, rerr },
                            '[LLM] compliance: retry refused, treating the answer as unusable'
                        )
                    }
                    if (retryOk) {
                        data = retryD.raw
                        recordTimings(retryD.raw && retryD.raw.timings)
                        content = retryD.content
                    }
                }
                try {
                    parsed = extractJson(content)
                } catch (err) {
                    parsed = null
                }
            }
            if (parsed === null) {
                logger.warn(
                    { projectId, pass: i },
                    '[LLM] compliance: pass answer unusable twice, marking na'
                )
                allItems.push({
                    requirement: job.currentRequirement,
                    status: 'na',
                    evidence:
                        'The check produced an unusable answer twice (likely the analysis exceeded the per-pass token budget)',
                    suggestion:
                        'Consider splitting this requirement into narrower ones in the rubric',
                })
                continue
            }

            // overleaf-lab: "analysis" is dropped on purpose: its job was forcing the
            // model to look before judging, and that job ends at generation time.
            // Evidence/suggestion are HARD-capped in code: the prompt asks for
            // compact evidence but the model sometimes dumps whole environments
            // anyway, and a report is read by a human. Enumerations belong in
            // "analysis", which has already served its purpose.
            const passItems = Array.isArray(parsed.items)
                ? parsed.items.map(it => ({
                      requirement:
                          repairJsonEscapeArtifacts(it.requirement || '') ||
                          job.currentRequirement,
                      status: ['ok', 'partial', 'missing', 'na'].includes(it.status)
                          ? it.status
                          : 'na',
                      evidence: repairJsonEscapeArtifacts(it.evidence || '').slice(0, 600),
                      suggestion: repairJsonEscapeArtifacts(it.suggestion || '').slice(
                          0,
                          600
                      ),
                  }))
                : []
            allItems.push(...passItems)
        } catch (err) {
            // An abort (user cancel or the pass timeout) must stop the whole review;
            // anything else downgrades to an unverifiable requirement.
            if (job.status === 'cancelled' || isAbortErr(err)) {
                throw err
            }
            logger.warn({ projectId, pass: i, err }, '[LLM] compliance: pass failed')
            allItems.push({
                requirement: job.currentRequirement,
                status: 'na',
                evidence: `The check failed (${err.message})`,
                suggestion: '',
            })
        } finally {
            clearTimeout(timeout)
            // In the finally so the `continue` paths (refusal, unparseable) count too.
            completedPasses += 1
            job.passesDone = completedPasses
        }
    }
    job.passesDone = completedPasses
    job.currentRequirement = ''

    // overleaf-lab: adversarial verification. Reviewer verdicts on the hardest checks
    // (e.g. matching every number with a nearby \cite across a whole thesis) are
    // noisy, and a false "missing" is the most harmful outcome a review can produce.
    // Each selected item gets one dedicated pass (riding the same document
    // prompt-cache prefix) where the model must test whether the finding holds up;
    // refuted evidence is dropped, fully refuted findings flip to ok, and an "ok"
    // whose quotes fail the mechanical grounding check gets its evidence re-grounded
    // or its status downgraded. Best-effort: a failed verification keeps the original
    // finding. Clean OK items are not re-verified, since doubling the whole review's
    // cost to double-check its successes is not worth it.
    // overleaf-lab: mechanical quote grounding feeds the selection: an item whose
    // evidence quotes text the source does not contain is a judge hallucination
    // suspect REGARDLESS of its status, so an "ok" propped up by fabricated quotes
    // gets double-checked too. Negatives keep priority for the capped slots.
    const groundingByItem = allItems.map(item =>
        countUngroundedQuotes(item.evidence, normalizedSource)
    )
    const indicesToVerify = []
    for (const [k, item] of allItems.entries()) {
        if (
            indicesToVerify.length < VERIFY_MAX_FINDINGS &&
            (item.status === 'missing' || item.status === 'partial')
        ) {
            indicesToVerify.push(k)
        }
    }
    for (const [k] of allItems.entries()) {
        if (
            indicesToVerify.length < VERIFY_MAX_FINDINGS &&
            !indicesToVerify.includes(k) &&
            groundingByItem[k].missing > 0
        ) {
            indicesToVerify.push(k)
        }
    }
    if (indicesToVerify.length > 0) {
        // Extend the pass count so the progress bar reports the extra work honestly.
        job.passesTotal = mainPassCount + indicesToVerify.length
        for (const idx of indicesToVerify) {
            if (job.status === 'cancelled') {
                throw new Error('review cancelled between passes')
            }
            const finding = allItems[idx]
            job.currentRequirement = `Double-check: ${finding.requirement}`
                .replace(/\s+/g, ' ')
                .slice(0, 160)

            const verifyBody = {
                model: reviewModel,
                messages: [
                    { role: 'system', content: VERIFY_SYSTEM_PROMPT },
                    {
                        role: 'user',
                        content:
                            documentBlock +
                            `FINDING (verify it against the DOCUMENT above):\n${JSON.stringify(
                                {
                                    requirement: finding.requirement,
                                    status: finding.status,
                                    evidence: finding.evidence,
                                    suggestion: finding.suggestion,
                                }
                            )}${
                                groundingByItem[idx].missing > 0
                                    ? `\n\nNOTE: a mechanical text search could NOT find ${groundingByItem[idx].missing} of the quoted passage(s) verbatim in the document. Treat those quotes as suspect.`
                                    : ''
                            }`,
                    },
                ],
                max_tokens: perPassBudget,
                // Deterministic: the verifier re-reads facts, it does not create.
                temperature: 0,
                response_format: {
                    type: 'json_schema',
                    json_schema: {
                        name: 'compliance_review',
                        strict: true,
                        schema: REVIEW_ITEMS_SCHEMA,
                    },
                },
            }

            const timeout = setTimeout(() => {
                if (job.controller) {
                    job.controller.abort()
                }
            }, passTimeoutMs())
            try {
                // overleaf-lab: PR item 4 — provider call; a refusal now throws and
                // falls into the outer catch ("keeping the finding"), same as before.
                const detailed = await llmChat(verifyBody, {
                    signal: job.controller ? job.controller.signal : undefined,
                })
                try {
                    const parsed = extractJson(detailed.content)
                    const verified = Array.isArray(parsed.items)
                        ? parsed.items[0]
                        : null
                    if (
                        verified &&
                        ['ok', 'partial', 'missing', 'na'].includes(verified.status)
                    ) {
                        allItems[idx] = {
                            // The requirement is not the verifier's to rewrite.
                            requirement: finding.requirement,
                            status: verified.status,
                            evidence: repairJsonEscapeArtifacts(
                                verified.evidence || finding.evidence
                            ).slice(0, 600),
                            suggestion: repairJsonEscapeArtifacts(
                                verified.suggestion || ''
                            ).slice(0, 600),
                        }
                    }
                } catch (err) {
                    logger.warn(
                        { projectId, err },
                        '[LLM] compliance: unparseable verification, keeping the finding'
                    )
                }
            } catch (err) {
                if (job.status === 'cancelled' || isAbortErr(err)) {
                    throw err
                }
                logger.warn(
                    { projectId, err },
                    '[LLM] compliance: verification pass failed, keeping the finding'
                )
            } finally {
                clearTimeout(timeout)
            }
            job.passesDone += 1
        }
        job.currentRequirement = ''
    }

    // overleaf-lab: final grounding annotation on whatever evidence survived: a quote
    // the mechanical search cannot find in the source is flagged to the reader
    // instead of standing in the report as false authority.
    for (const item of allItems) {
        const { missing } = countUngroundedQuotes(item.evidence, normalizedSource)
        if (missing > 0) {
            item.evidence = `${item.evidence} [warning: ${missing} quoted passage${
                missing === 1 ? '' : 's'
            } not found verbatim in the source]`
        }
    }

    // overleaf-lab: synthesize the overall summary from the ITEMS ONLY (no document,
    // so this call is small and cheap). Best-effort: a failure leaves the summary
    // empty instead of failing a review whose per-requirement work already succeeded.
    let summary = ''
    try {
        // overleaf-lab: PR item 4 — provider call; refusal fails only the summary.
        const summaryBody = {
            model: reviewModel,
            messages: [
                {
                    role: 'system',
                    content:
                        'You summarize the outcome of a compliance review of a LaTeX document against writing guidelines. Given the review items, write a 2 to 4 sentence overall assessment IN THE SAME LANGUAGE as the items, mentioning the main problems found (or that none were found). Return ONLY a JSON object shaped {"summary": "..."}.',
                },
                {
                    role: 'user',
                    content: JSON.stringify({
                        rubric: rubric.name,
                        items: allItems.map(it => ({
                            requirement: it.requirement,
                            status: it.status,
                            evidence: it.evidence.slice(0, 200),
                        })),
                    }),
                },
            ],
            max_tokens: 500,
            temperature: 0.2,
            response_format: {
                type: 'json_schema',
                json_schema: {
                    name: 'compliance_summary',
                    strict: true,
                    schema: REVIEW_SUMMARY_SCHEMA,
                },
            },
        }
        let detailed = null
        try {
            detailed = await llmChat(summaryBody, {
                signal: job.controller ? job.controller.signal : undefined,
            })
        } catch (err) {
            if (job.status === 'cancelled' || isAbortErr(err)) {
                throw err
            }
            logger.warn({ projectId, err }, '[LLM] compliance: summary synthesis refused')
        }
        if (detailed) {
            summary = repairJsonEscapeArtifacts(extractJson(detailed.content).summary || '')
        }
    } catch (err) {
        if (job.status === 'cancelled' || isAbortErr(err)) {
            throw err
        }
        logger.warn({ projectId, err }, '[LLM] compliance: summary synthesis failed')
    }

    return {
        type: 'done',
        result: {
            rubric: { id: rubric.id, name: rubric.name },
            model: reviewModel,
            documentTokensEstimate: promptTokens,
            maxContextTokens,
            summary,
            items: allItems,
        },
    }
}

// overleaf-lab: run the next queued job, one at a time. Recurse to skip missing or
// already-cancelled jobs, and always try the next job in a finally so a single job
// failure never stalls the queue.
async function processQueue() {
    if (running || queue.length === 0) {
        return
    }

    const jobId = queue.shift()
    const job = jobs.get(jobId)
    if (!job || job.status === 'cancelled') {
        // overleaf-lab: skip a job that vanished or was cancelled while queued.
        return processQueue()
    }

    running = true
    job.status = 'running'
    job.startedAt = Date.now()
    job.controller = new AbortController()
    void persistJobUpdate(job.id, job) // overleaf-lab (audit M2)

    try {
        const outcome = await performReview(job)
        // overleaf-lab: a cancel may have landed mid-run; if so, keep 'cancelled'.
        if (job.status !== 'cancelled') {
            if (outcome.type === 'done') {
                job.status = 'done'
                job.result = outcome.result
            } else {
                job.status = 'error'
                job.errorCode = outcome.errorCode
                job.message = outcome.message
                if (outcome.errorCode === 'too_long') {
                    job.documentTokensEstimate = outcome.documentTokensEstimate
                    job.reviewMaxTokens = outcome.reviewMaxTokens
                    job.maxContextTokens = outcome.maxContextTokens
                }
            }
        }
    } catch (err) {
        // overleaf-lab: cancel aborts the controller after setting status
        // 'cancelled', so keep that; any other throw (the review timeout abort or an
        // HTTP/parse failure) becomes a generic 'failed'.
        if (job.status !== 'cancelled') {
            job.status = 'error'
            job.errorCode = 'failed'
            job.message = 'The review request failed or timed out'
            logger.error(
                { projectId: job.projectId, userId: job.userId, err },
                '[LLM] compliance: review job failed'
            )
        }
    } finally {
        job.finishedAt = Date.now()
        void persistJobUpdate(job.id, job) // overleaf-lab (audit M2)
        running = false
        job.controller = null
        // overleaf-lab: never let one job's failure stall the queue.
        processQueue().catch(err => {
            logger.error({ err }, '[LLM] compliance: failed to continue the queue')
        })
    }
}

async function getRubrics(req, res) {
    // overleaf-lab: review feature disabled by admin -> no rubrics to offer.
    const flags = await getLLMFeatureFlags()
    if (!flags.reviewEnabled) {
        return res.json({ rubrics: [] })
    }
    // overleaf-lab (2026-08-27): USER-SCOPED rubrics (the user configured them
    // under /user/llm-settings); a user without their own inherits the
    // deployment-wide set.
    const userId = SessionManager.getLoggedInUserId(req.session)
    const rubrics = await getComplianceRubricsForUser(userId)
    // overleaf-lab: expose names only, never the guidelines text, to the project UI.
    res.json({ rubrics: rubrics.map(r => ({ id: r.id, name: r.name })) })
}

// overleaf-lab: enqueue a review and return its job id. Always answers HTTP 200;
// success vs a logical error is distinguished by the `ok` field.
async function startReview(req, res) {
    // 1. Service disabled globally.
    if (Settings.llm && !Settings.llm.enabled) {
        return res.json({ ok: false, error: 'disabled', message: 'LLM service is disabled' })
    }

    // overleaf-lab: review feature disabled by admin.
    const flags = await getLLMFeatureFlags()
    if (!flags.reviewEnabled) {
        return res.json({ ok: false, error: 'disabled', message: 'The review feature is disabled' })
    }

    // 2. Request context.
    const projectId = req.params.Project_id
    const userId = SessionManager.getLoggedInUserId(req.session)
    const { rubricId, model: requestedModel } = req.body || {}

    logger.debug({ projectId, userId, rubricId }, '[LLM] compliance: start requested')

    // 3. Resolve the requested rubric (capture its name for the job).
    // overleaf-lab (2026-08-27): from the USER's own rubrics (fall back to the
    // deployment-wide set) — rubrics are per-user now, not global.
    const rubrics = await getComplianceRubricsForUser(userId)
    const rubric = rubrics.find(r => r.id === rubricId)
    if (!rubric) {
        return res.json({ ok: false, error: 'no_rubric', message: 'Unknown or missing rubric' })
    }

    // 4. A usable lane must exist: the user's selection / BYO row / site backend.
    // overleaf-lab (2026-08-27): deployments WITHOUT a global LLM are first-class
    // — resolving the lane also honors the user's profile selection and BYO rows.
    try {
        await resolveModelLane(userId, (typeof requestedModel === 'string' && requestedModel.trim()) || undefined, 'review')
    } catch (err) {
        logger.debug({ userId, err: err?.message }, '[LLM] compliance: no usable lane')
        return res.json({
            ok: false,
            error: 'not_configured',
            message: 'No usable LLM backend: set a model (File → Select LLM Model) or add your own LLM connection',
        })
    }

    // overleaf-lab (audit M2): mark jobs stuck by the previous process (if any).
    await sweepStuckJobsOnce()
    // overleaf-lab: F6 — concurrency caps. One user keeps at most one review
    // running plus two queued; the global queue stays bounded so a slow shared
    // backend cannot be stacked with work by many projects.
    // overleaf-lab (audit M2): count from Mongo when possible (it includes the
    // in-memory jobs, which are all mirrored); fall back to the in-memory count
    // if Mongo cannot be reached, so a store hiccup never blocks reviews.
    const inMemoryActive = [...jobs.values()].filter(
        j => j.userId === userId && (j.status === 'running' || j.status === 'queued')
    ).length
    const userActive = (await countUserActiveJobs(userId)) ?? inMemoryActive
    if (userActive >= MAX_USER_REVIEWS_IN_FLIGHT) {
        return res.json({
            ok: false,
            error: 'too_many',
            message: `You already have ${MAX_USER_REVIEWS_IN_FLIGHT} reviews running or queued; wait for one to finish`,
        })
    }
    if (queue.length >= MAX_GLOBAL_QUEUE) {
        return res.json({
            ok: false,
            error: 'server_busy',
            message: 'Several reviews are already queued; try again shortly',
        })
    }

    // 5. Create and enqueue the job.
    sweepOldJobs()
    const job = {
        id: newJobId(),
        projectId,
        userId,
        rubricId,
        rubricName: rubric.name,
        // overleaf-lab: Review-tab model selector — explicit model ref
        // (site id or 'u:<rowId>:<model>'); null = deployment default.
        modelOverride: typeof requestedModel === 'string' && requestedModel.trim() ? requestedModel.trim().slice(0, 300) : null,
        status: 'queued',
        result: null,
        errorCode: null,
        message: null,
        documentTokensEstimate: null,
        maxContextTokens: null,
        reviewMaxTokens: null,
        controller: null,
        createdAt: Date.now(),
        startedAt: null,
        finishedAt: null,
        // overleaf-lab: pass-based progress (one model call per requirement),
        // filled in by performReview and read by the status endpoint.
        passesTotal: null,
        passesDone: 0,
        currentRequirement: '',
    }
    jobs.set(job.id, job)
    void persistJobCreate(job) // overleaf-lab (audit M2)
    queue.push(job.id)
    // overleaf-lab: kick the queue; it runs to its first await, so if nothing else
    // is running this job may already be 'running' by the time we respond.
    processQueue().catch(err => {
        logger.error({ err }, '[LLM] compliance: failed to launch the queue')
    })

    return res.json({
        ok: true,
        jobId: job.id,
        status: job.status,
        position: jobsAhead(job.id),
    })
}

// overleaf-lab: report a job's state. Always HTTP 200; a missing/foreign/expired
// job is reported as ok:false error:'not_found'.
async function statusReview(req, res) {
    const job = jobs.get(req.params.jobId)
    const userId = SessionManager.getLoggedInUserId(req.session)
    if (!job || job.userId !== userId) {
        await sweepStuckJobsOnce() // overleaf-lab (audit M2)
        // overleaf-lab (audit M2): the job is not live in this process. It may
        // still exist in Mongo from before a restart — answer from there, and
        // turn a stale queued/running doc into a definitive failure.
        const doc = await findUserJobDoc(req.params.jobId, userId)
        if (doc) {
            if (doc.status === 'running' || doc.status === 'queued') {
                const message =
                    'The server restarted while the review was running. Please start it again.'
                await persistJobFinalStatus(doc.jobId, {
                    status: 'error',
                    errorCode: 'server-restarted',
                    message,
                    finishedAt: new Date(),
                })
                return res.json({
                    ok: true,
                    status: 'error',
                    errorCode: 'server-restarted',
                    message,
                })
            }
            if (doc.status === 'done') {
                return res.json({ ok: true, status: 'done', result: doc.result })
            }
            if (doc.status === 'error') {
                return res.json({
                    ok: true,
                    status: 'error',
                    errorCode: doc.errorCode,
                    message: doc.message,
                    documentTokensEstimate: doc.documentTokensEstimate,
                    maxContextTokens: doc.maxContextTokens,
                    reviewMaxTokens: doc.reviewMaxTokens,
                })
            }
            if (doc.status === 'cancelled') {
                return res.json({ ok: true, status: 'cancelled' })
            }
        }
        return res.json({ ok: false, error: 'not_found', message: 'Review not found or expired' })
    }

    switch (job.status) {
        case 'queued':
            return res.json({ ok: true, status: 'queued', position: jobsAhead(job.id) })
        case 'running': {
            // overleaf-lab: pass-based progress. Each requirement is checked by its
            // own model call, so the bar reports REAL progress (passes completed over
            // total) instead of a time estimate. Before the rubric is split we are
            // still assembling the document: report 'preparing'.
            if (!job.passesTotal) {
                return res.json({ ok: true, status: 'running', phase: 'preparing' })
            }
            return res.json({
                ok: true,
                status: 'running',
                phase: job.passesDone >= job.passesTotal ? 'summarizing' : 'checking',
                passesDone: job.passesDone,
                passesTotal: job.passesTotal,
                currentRequirement: job.currentRequirement || '',
                elapsedMs: Date.now() - (job.startedAt || job.createdAt),
            })
        }
        case 'done':
            return res.json({ ok: true, status: 'done', result: job.result })
        case 'error':
            return res.json({
                ok: true,
                status: 'error',
                errorCode: job.errorCode,
                message: job.message,
                documentTokensEstimate: job.documentTokensEstimate,
                maxContextTokens: job.maxContextTokens,
                reviewMaxTokens: job.reviewMaxTokens,
            })
        case 'cancelled':
            return res.json({ ok: true, status: 'cancelled' })
        default:
            return res.json({ ok: false, error: 'not_found', message: 'Review not found or expired' })
    }
}

// overleaf-lab: cancel a job. Idempotent and never errors, so a keepalive/beacon
// call on page unload stays simple. Only the owner can cancel.
async function cancelReview(req, res) {
    const job = jobs.get(req.params.jobId)
    const userId = SessionManager.getLoggedInUserId(req.session)
    if (job && job.userId === userId) {
        if (job.status === 'queued') {
            // overleaf-lab: pull it out of the queue so it never runs.
            const idx = queue.indexOf(job.id)
            if (idx !== -1) {
                queue.splice(idx, 1)
            }
            job.status = 'cancelled'
            job.finishedAt = Date.now()
        } else if (job.status === 'running') {
            // overleaf-lab: mark cancelled first, then abort so processQueue keeps
            // 'cancelled' instead of turning the abort into 'failed'. The finally in
            // processQueue sets finishedAt.
            job.status = 'cancelled'
            if (job.controller) {
                job.controller.abort()
            }
        }
        // done/error/cancelled: no-op.
    } else if (!job) {
        // overleaf-lab (audit M2): the job is not live here (e.g. after a
        // restart) — cancel it in Mongo if it is still pending, so the poller
        // sees a definitive state.
        const doc = await findUserJobDoc(req.params.jobId, userId)
        if (doc && (doc.status === 'queued' || doc.status === 'running')) {
            await persistJobFinalStatus(doc.jobId, { status: 'cancelled', finishedAt: new Date() })
        }
    }
    return res.json({ ok: true })
}

export default {
    getRubrics: expressify(getRubrics),
    startReview: expressify(startReview),
    statusReview: expressify(statusReview),
    cancelReview: expressify(cancelReview),
}
