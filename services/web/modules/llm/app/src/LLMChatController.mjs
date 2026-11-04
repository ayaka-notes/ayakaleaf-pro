/*
 * LLMChatController - chat, inline completion, model discovery, features,
 * whole-document generators, source context, and prompt resolution.
 *
 * Lane routing (the model id IS the router):
 *  - site models:     bare model id (e.g. "qwen3.8:latest")
 *  - user BYO rows:   namespaced id  u:<rowId8hex>:<modelId>
 *
 * A request without a model resolves, in order: the user's first enabled BYO
 * row (when allowed), then the site default. This preserves the old
 * "personal settings preferred, shared fallback" behavior.
 *
 * Gating (F1): every user lane requires LLM_ALLOW_USER_SETTINGS=true.
 * Allowlist (F2): site-lane model ids must be in the admin allowedModels.
 * Provider calls go through LLMClient (Vercel AI SDK).
 */

import logger from '@overleaf/logger'
import { expressify } from '@overleaf/promise-utils'
import SessionManager from '../../../../app/src/Features/Authentication/SessionManager.mjs'
import Settings from '@overleaf/settings'
import ProjectEntityHandler from '../../../../app/src/Features/Project/ProjectEntityHandler.mjs'
import { getSystemPrompt, getAdminLLMSettings, getLLMFeatureFlags, getLLMPrompts, readAdminSettings } from './LLMAdminController.mjs'
import { decryptSecret } from './LLMCrypto.mjs'
import { chatText, chatObject, normalizeProviderSpec, detectProviderType, assertNonEmpty } from './LLMClient.mjs'
import { isUserSettingsAllowed, loadProviders, resolveProfileModelForTask } from './LLMSettingsController.mjs'
import { User } from '../../../../app/src/models/User.mjs'
import { parseModelRef } from './LLMModelRef.mjs'
import { guardLLMCall } from './LLMBudget.mjs' // overleaf-lab: per-user rate + daily token budget (F4)
import { compileFixSchema, validateCompileFixObject, buildCompileFixMessages } from './LLMCompileFix.mjs' // overleaf-lab: AI Error Assist

/*
 * Build the model list for the editor picker: site models (bare ids) plus
 * the user's enabled BYO rows (namespaced ids, grouped).
 */
async function getSiteModels() {
    const adminSettings = await getAdminLLMSettings()
    let models = Array.isArray(adminSettings.allowedModels)
        ? adminSettings.allowedModels.filter(m => typeof m === 'string' && m.trim().length > 0)
        : []
    if (!models.length) {
        const modelsEnv = process.env.LLM_AVAILABLE_MODELS || process.env.LLM_MODEL_NAME
        if (modelsEnv) models = modelsEnv.split(',').map(m => m.trim()).filter(Boolean)
    }
    return models.map((id, index) => ({ id, name: id.replace(/-/g, ' ').toUpperCase(), isDefault: index === 0 }))
}

async function getModels(req, res) {
    const userId = SessionManager.getLoggedInUserId(req.session)
    const projectId = req.params.Project_id

    if (Settings.llm && !Settings.llm.enabled) {
        return res.json({ models: [], userRows: [] })
    }
    // overleaf-lab (grammar port): admin force-off hides the model list.
    if (readAdminSettings().llmDisabledByAdmin === true) {
        return res.json({ models: [], userRows: [] })
    }
    const flags = await getLLMFeatureFlags()
    if (!flags.chatEnabled) {
        return res.json({ models: [], userRows: [] })
    }

    const siteModels = await getSiteModels()
    const userRows = []
    if (userId && isUserSettingsAllowed()) {
        try {
            const providers = await loadProviders(userId)
            for (const row of providers.filter(r => r.enabled !== false && r.models?.length)) {
                userRows.push({
                    id: row.id,
                    name: row.name,
                    providerType: row.providerType,
                    completionModel: row.completionModel || '',
                    models: row.models.map((modelId, index) => ({
                        id: `u:${row.id}:${modelId}`,
                        name: modelId,
                        isDefault: index === 0
                    }))
                })
            }
        }
        catch (error) {
            logger.warn({ userId, projectId, err: error }, '[LLM] getModels: user rows failed')
        }
    }

    // overleaf-lab (2026-11): the model picker shows each model's PROVIDER —
    // several providers can serve the same model name, so the site connection
    // advertises its host name (BYO rows already carry their row name).
    let siteProvider = 'Site'
    try {
        const admin = await getAdminLLMSettings()
        const host = (admin.llmApiUrl || process.env.LLM_API_URL || '').replace(/^https?:\/\//, '').split('/')[0]
        if (host) siteProvider = 'Site \u00b7 ' + host
    } catch { /* label only */ }
    logger.debug({ count: siteModels.length, userRows: userRows.length }, '[LLM] getModels: returning models')
    res.json({ models: siteModels, userRows, siteProvider })
}

/*
 * Resolve the shared (site) lane. Returns { spec } or null when unconfigured.
 * Enforces the admin model allowlist (F2) for explicit model ids.
 */
async function resolveSiteLane(modelName) {
    const adminSettings = await getAdminLLMSettings()
    const baseUrl = adminSettings.llmApiUrl || process.env.LLM_API_URL
    const apiKey = adminSettings.llmApiKey ? decryptSecret(adminSettings.llmApiKey) : (process.env.LLM_API_KEY || '')
    const providerType = adminSettings.llmProviderType || adminSettings.llmApiType || detectProviderType(baseUrl)

    const allowed = Array.isArray(adminSettings.allowedModels)
        ? adminSettings.allowedModels.filter(m => typeof m === 'string' && m.trim().length > 0)
        : []
    const allowedEnv = (process.env.LLM_AVAILABLE_MODELS || process.env.LLM_MODEL_NAME || '')
        .split(',').map(m => m.trim()).filter(Boolean)
    const pool = allowed.length ? allowed : allowedEnv

    const model = modelName || pool[0]
    if (modelName && pool.length && !pool.includes(modelName)) {
        throw Object.assign(
            new Error(`Model "${modelName}" is not available on the site backend`),
            { code: 'llm-bad-model' }
        )
    }
    if (!baseUrl || !model) {
        throw Object.assign(new Error('LLM service is not configured'), { code: 'llm-disabled' })
    }
    const spec = normalizeProviderSpec({ providerType, baseUrl, apiKey }, { model })
    return { spec, model: spec.model }
}

/*
 * Resolve a user BYO lane from a namespaced model ref (or the first enabled
 * row when no model id was sent). Enforces the BYO gate (F1).
 */
async function resolveUserLane(userId, ref) {
    if (!isUserSettingsAllowed()) {
        throw Object.assign(new Error('Bring-your-own LLM settings are disabled on this deployment'), { code: 'disabled' })
    }
    const providers = await loadProviders(userId)
    let row = null
    if (ref?.rowId) {
        row = providers.find(r => r.id === ref.rowId)
        if (!row) throw Object.assign(new Error('Unknown provider row'), { code: 'llm-bad-row' })
        if (ref.model && !row.models?.includes(ref.model)) {
            throw Object.assign(new Error(`Model "${ref.model}" is not in the provider "${row.name}"`), { code: 'llm-bad-model' })
        }
    }
    else {
        row = providers.find(r => r.enabled !== false && r.models?.length)
        if (!row) throw Object.assign(new Error('No BYO provider configured'), { code: 'llm-bad-row' })
    }
    if (row.enabled === false) {
        throw Object.assign(new Error(`Provider "${row.name}" is disabled`), { code: 'llm-bad-row' })
    }
    const modelName = ref?.model || row.completionModel || row.models?.[0]
    if (!modelName) throw Object.assign(new Error('Provider row has no models'), { code: 'llm-bad-row' })
    const spec = normalizeProviderSpec(
        {
            providerType: row.providerType,
            baseUrl: row.baseUrl || '',
            apiKey: row.apiKey ? decryptSecret(row.apiKey) : ''
        },
        { model: modelName }
    )
    return { spec, model: spec.model, row }
}

/*
 * Map a client model ref (or none) to { spec, model, lane }. A bare/missing
 * model on the site lane wins over user rows ONLY when user rows do not
 * exist - users keep their preference for their own backends (old behavior).
 *
 * overleaf-lab (owner request 2026-08-26): an EMPTY model ref now first falls
 * back to the user's SHARED selection stored on the profile
 * (User.llmSelectedModel — File → "Select LLM Model"), so every surface
 * (chat, review, generators, compile-fix) honors the one user-scoped choice
 * without the client repeating it in each request. An explicit request ref
 * always still wins.
 */
async function resolveLane(userId, modelRef, task = 'chat') {
    // overleaf-lab (grammar port): admin force-off is enforced at the shared
    // lane-resolution choke point, so chat / completion / generators /
    // compile-fix / review / grammar ALL fall over with one switch.
    if (readAdminSettings().llmDisabledByAdmin === true) {
        throw Object.assign(
            new Error('LLM service is disabled by the administrator'),
            { code: 'llm-disabled' }
        )
    }
    if (!modelRef.model) {
        // overleaf-lab (2026-11): per-task profile value first, then the shared
        // selection (resolveProfileModelForTask does both).
        const profileRef = await resolveProfileModelForTask(userId, task)
        if (profileRef) {
            modelRef = parseModelRef(profileRef)
        }
    }
    if (modelRef.kind === 'user') {
        return { ...(await resolveUserLane(userId, modelRef)), lane: 'user' }
    }
    const providers = isUserSettingsAllowed() ? await loadProviders(userId).catch(() => []) : []
    const hasEnabledRow = providers.some(r => r.enabled !== false && r.models?.length)
    if (!modelRef.model && hasEnabledRow) {
        return { ...(await resolveUserLane(userId, { rowId: null })), lane: 'user' }
    }
    if (modelRef.model && modelRef.model.startsWith('personal-')) {
        // Legacy id from pre-BYO clients: treat as the first user row.
        if (hasEnabledRow) {
            return { ...(await resolveUserLane(userId, { rowId: null, model: modelRef.model.slice('personal-'.length) })), lane: 'user' }
        }
    }
    return { ...(await resolveSiteLane(modelRef.model)), lane: 'site' }
}

// overleaf-lab: expose lane resolution so other features (e.g. the Review tab's
// model selector) can honor an explicit model ref — either a site model id or
// a namespaced 'u:<rowId>:<model>' BYO ref — with that row's own baseUrl + key.
export async function resolveModelLane(userId, modelRefString, task = 'chat') {
    return resolveLane(userId, parseModelRef(String(modelRefString || '').trim()), task)
}

function sendError(res, err, fallbackStatus) {
    const statusMap = {
        auth: 401,
        'llm-bad-model': 404,
        'llm-rate-limited': 429,
        disabled: 403,
        'llm-bad-row': 400,
        'llm-bad-config': 400,
        'llm-invalid': 400,
        'empty-response': 502,
        'llm-timeout': 504,
        'llm-abort': 409,
        'llm-disabled': 503,
        'llm-budget': 429
    }
    const status = statusMap[err?.code] || fallbackStatus || 502
    logger.error?.({ code: err?.code, message: err?.message }, '[LLM] request failed')
    res.status(status).json({
        ok: false,
        error: err?.code || 'llm-error',
        message: err?.message || 'LLM request failed'
    })
}

async function chat(req, res) {
    const { messages, model: modelRefString } = req.body
    const projectId = req.params.Project_id
    const userId = SessionManager.getLoggedInUserId(req.session)

    if (!Array.isArray(messages) || !messages.length) {
        return res.status(400).json({ ok: false, error: 'llm-invalid', message: 'messages must be a non-empty array' })
    }
    if (Settings.llm && !Settings.llm.enabled) {
        return res.status(503).json({ ok: false, error: 'llm-disabled', message: 'LLM service is disabled' })
    }
    const flags = await getLLMFeatureFlags()
    if (!flags.chatEnabled) {
        return res.status(403).json({ ok: false, error: 'feature_disabled', message: 'The chat feature is disabled' })
    }

    // overleaf-lab: F4 — per-user rate + daily token budget (both lanes).
    let budget
    try {
        budget = await guardLLMCall(userId)
    }
    catch (err) {
        return sendError(res, err, 429)
    }

    let lane
    let spec
    let model
    try {
        // overleaf-lab (2026-11): task-aware — the review pane sends task:'review'
        // (see the handler above) so its per-task model slot is honored.
        const resolved = await resolveLane(userId, parseModelRef(modelRefString), task)
        lane = resolved.lane
        spec = resolved.spec
        model = resolved.model
    }
    catch (err) {
        return sendError(res, err, 400)
    }

    // System prompt: admin-configured prompt (if any) + language-follow
    // instruction, merged with a client system message when present.
    // overleaf-lab (2026-11): no language examples in the instruction — a
    // concrete example ("e.g. answer in Italian ...") anchors small models
    // toward that language. The directive must stay neutral.
    const languageInstruction = "Reply in the same language as the user's latest message. Never pick a different language on your own."
    const adminSystemPrompt = lane === 'site' ? (await getSystemPrompt()) : ''
    const systemPreamble = adminSystemPrompt
        ? `${adminSystemPrompt}\n\n${languageInstruction}`
        : languageInstruction
    const hasSystemMessage = messages[0]?.role === 'system'
    const finalMessages = hasSystemMessage
        ? [{ role: 'system', content: `${systemPreamble}\n\n${messages[0].content}` }, ...messages.slice(1)]
        : [{ role: 'system', content: systemPreamble }, ...messages]
    // overleaf-lab (2026-11): small models often ignore a system-side language
    // rule, so repeat the directive right after the user's own turn — a trailing
    // user-side instruction dominates a weak model's output language.
    try {
        for (let i = finalMessages.length - 1; i >= 0; i--) {
            if (finalMessages[i].role === 'user') {
                finalMessages[i] = {
                    ...finalMessages[i],
                    content: `${finalMessages[i].content}\n\n(Instruction: reply in the same language as my message above.)`
                }
                break
            }
        }
    } catch { /* non-fatal: language reminder only */ }

    const started = Date.now()
    logger.info(
        { projectId, lane, model, messages: messages.length, timeout: 300000 },
        '[LLM] chat: sending request'
    )
    try {
        const { text, usage, finishReason } = await chatText(
            spec,
            finalMessages,
            {
                maxOutputTokens: 8192,
                temperature: 0.7,
                timeoutMs: 300000,
                usageMeta: { userId, action: 'chat', lane, projectId }, // overleaf-lab (usage meter)
            }
        )
        assertNonEmpty(text)
        budget.record(usage?.outputTokens)
        logger.info({ projectId, lane, model, duration: `${Date.now() - started}ms` }, '[LLM] chat: ok')
        res.json({ ok: true, content: text.trim(), usage, model, lane, finishReason })
    }
    catch (err) {
        sendError(res, err, 502)
    }
}

// overleaf-lab (2026-11): weak BYO models sometimes repeat the word at the
// cursor seam: the prefix ends in a (possibly partial) word P, and the
// suggestion re-states P (or P completed by the earlier suggestion words) as
// one of its first words — "… be th" + "e the first step…" gives "the the
// first step", "… a" + "a software engineer" gives "aa software engineer".
// Detect that one duplicated word and drop it from the suggestion:
//   P + w1 + … + w(i-1)  ==  w(i)      (case/punctuation-insensitive,
//   spaces removed), for one of the first three suggestion words w(i).
// Anything that does not match this exact shape is left untouched — the
// editor applies the result as a plain ghost-text insertion, so it is safe.
function stripSeamDuplication(leftContext, suggestion) {
    if (!suggestion) return suggestion
    const left = String(leftContext || '')
    const trimmed = left.trim()
    if (!trimmed) return suggestion
    const squeeze = (x) => String(x).toLowerCase().replace(/[^a-z0-9]/g, '')
    const lastWords = trimmed.split(/\s+/)
    const P = squeeze(lastWords[lastWords.length - 1])
    if (!P) return suggestion
    if (P.length < 2 && !/^[a-z]$/.test(P)) return suggestion // e.g. "\" or "$"
    const words = []
    const re = /\S+/g
    let m
    while ((m = re.exec(suggestion)) !== null && words.length < 3) {
        words.push({ start: m.index, end: m.index + m[0].length })
        if (!/[a-z0-9]/i.test(m[0])) break // LaTeX token seam — leave as is
    }
    if (!words.length) return suggestion
    let T = P
    for (let i = 0; i < words.length; i++) {
        const w = squeeze(suggestion.slice(words[i].start, words[i].end))
        if (w && T === w) {
            const head = suggestion.slice(0, words[i].start).replace(/\s+$/, '')
            const tail = suggestion.slice(words[i].end).replace(/^\s+/, ' ')
            return (head + tail).replace(/^\s+/, '')
        }
        T += w
    }
    return suggestion
}

async function completion(req, res) {
    const projectId = req.params.Project_id
    const userId = SessionManager.getLoggedInUserId(req.session)
    const { leftContext, rightContext, maxLength, model: modelRefString } = req.body

    if (!leftContext && !rightContext) {
        return res.status(400).json({ success: false, error: 'No context provided' })
    }
    if (Settings.llm && !Settings.llm.enabled) {
        return res.json({ success: true, data: '' }) // silent: no LLM at all
    }
    const flags = await getLLMFeatureFlags()
    if (!flags.completionEnabled) {
        return res.json({ success: true, data: '' })
    }

    // overleaf-lab (2026-11, owner request): per-user toggle — the editor
    // settings "Inline completion" switch; OFF means no ghost text.
    try {
        const prefsProfile = await User.findOne({ _id: userId }).lean()
        if (prefsProfile?.completionEnabled === false) {
            return res.json({ success: true, data: '' })
        }
    } catch { /* profile read failed — continue (admin flag still gated above) */ }

    // overleaf-lab: F4 — the rate gate here is what makes inline completion safe
    // to run while typing (per-user, per-minute).
    let budget
    try {
        budget = await guardLLMCall(userId)
    }
    catch (err) {
        // Silent for completion: the editor simply shows no suggestion, with no
        // error toast (same semantics as disabled features).
        logger.debug({ userId, code: err?.code }, '[LLM] completion: budget gate')
        return res.json({ success: true, data: '' })
    }

    // Resolve the lane. overleaf-lab (2026-08-27, owner request): the client no
    // longer sends a model — order is the user's SHARED selection (profile),
    // then the first enabled BYO row, then the site backend. The former admin
    // "Inline completion model" picker is gone; deployments WITHOUT a global
    // LLM work through the same chain (BYO row or profile selection).
    const adminSettings = await getAdminLLMSettings()
    let ref = parseModelRef(modelRefString)
    let refFromProfile = false
    if (!ref.model) {
        // overleaf-lab (2026-11): task 'completion' override first, then shared.
        const profileValue = await resolveProfileModelForTask(userId, 'completion')
        if (profileValue) {
            try {
                ref = parseModelRef(profileValue)
                refFromProfile = true
            }
            catch { /* stale/invalid saved selection - fall through to the chain below */ }
        }
    }
    const adminSharedCompletionDisabled = adminSettings.completionModel === '__disabled__'
    const siteCompletionModel = adminSettings.completionModel !== '__disabled__'
        ? (adminSettings.completionModel ||
          process.env.LLM_COMPLETION_MODEL ||
          (process.env.LLM_MODEL_NAME || '').split(',')[0].trim())
        : null

    const candidates = []
    if (ref.kind === 'user') candidates.push({ lane: 'user', ref })
    else if (!ref.model && isUserSettingsAllowed()) candidates.push({ lane: 'user', ref: { rowId: null } })
    if (!adminSharedCompletionDisabled && (adminSettings.llmApiUrl || process.env.LLM_API_URL) && (adminSettings.allowedModels?.length || (process.env.LLM_AVAILABLE_MODELS || process.env.LLM_MODEL_NAME))) {
        if (adminSettings.allowedModels?.length) {
            if (!refFromProfile && ref.kind === 'site' && ref.model && !adminSettings.allowedModels.includes(ref.model)) {
                // explicit model not allowed -> reject (F2); a profile-derived
                // ref just fails this candidate and continues the chain
                return res.status(400).json({ success: false, error: `Model "${ref.model}" is not available` })
            }
        }
        candidates.push({ lane: 'site', ref })
    }

    const started = Date.now()
    let lastError = null
    for (const candidate of candidates) {
        try {
            const resolved = candidate.lane === 'user'
                ? { ...(await resolveUserLane(userId, candidate.ref)), lane: 'user' }
                : {
                      ...resolveSiteSpec(adminSettings, ref.model || siteCompletionModel),
                      lane: 'site'
                  }
            // overleaf-lab (2026-11): weak models used to RE-EMIT the word at the
            // cursor seam (prefix "…be th" → suggestion "e the first …", prefix
            // "…a" → "a software …"). The prompt now starts at the very next
            // character and forbids retyping existing text; a deterministic
            // post-filter (stripSeamDuplication) enforces it regardless.
            const systemPrompt = '/no_think\nYou are an invisible continuation engine. You will receive text that stops at a <CUT> mark. Output ONLY the exact characters that come immediately after <CUT>, as if finishing the sentence the author started. If <CUT> falls in the middle of a word, START WITH THE REMAINING CHARACTERS OF THAT SAME WORD. NEVER repeat, retype, or rewrite anything that already appears before <CUT>. No explanations, no markdown, no code fences, no tags. Continue in the same language as the surrounding text.'
            const userPrompt = `The text below stops at <CUT>. Continue it exactly from that point (output only the missing continuation, nothing else):\n\n${leftContext}<CUT>${rightContext}`
            const maxTokens = Math.max(16, Math.min(1024, parseInt(maxLength, 10) || 320))
            const { text, usage } = await chatText(
                resolved.spec,
                [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                {
                    maxOutputTokens: maxTokens,
                    temperature: 0.2,
                    timeoutMs: 15000,
                    usageMeta: { userId, action: 'completion', lane: resolved.lane, projectId }, // overleaf-lab (usage meter)
                }
            )
            // overleaf-lab (2026-11): strip the duplicated seam word the model
            // re-emitted ("th" + "e the …" -> "e …"; "a" + "a …" -> "").
            const data = stripSeamDuplication(leftContext, text || '')
            budget.record(usage?.outputTokens)
            logger.debug(
                { projectId, lane: resolved.lane, model: resolved.model, len: data.length, duration: `${Date.now() - started}ms` },
                '[LLM] completion: ok'
            )
            return res.json({ success: true, data, model: resolved.model, lane: resolved.lane })
        }
        catch (err) {
            lastError = err
            logger.debug({ lane: candidate.lane, code: err?.code, message: err?.message }, '[LLM] completion: lane failed, trying next')
        }
    }

    const error = lastError || Object.assign(new Error('No usable LLM backend configured'), { code: 'llm-disabled' })
    if (error.code === 'disabled' || error.code === 'llm-bad-row') {
        // No valid BYO lane is allowed/configured: silent empty suggestion.
        return res.json({ success: true, data: '' })
    }
    logger.warn({ projectId, err: error.message, code: error.code }, '[LLM] completion: all lanes failed')
    const status = error.code === 'auth' ? 401 : (error.code === 'llm-disabled' ? 503 : 502)
    return res.status(status).json({ success: false, error: error.code || 'Completion failed', message: error.message })
}

/*
 * Site lane spec builder (inline to avoid the circular-resolve dance used in
 * resolveSiteLane, which also enforces the allowlist on explicit ids).
 */
function resolveSiteSpec(adminSettings, modelName) {
    const baseUrl = adminSettings.llmApiUrl || process.env.LLM_API_URL
    const apiKey = adminSettings.llmApiKey ? decryptSecret(adminSettings.llmApiKey) : (process.env.LLM_API_KEY || '')
    const providerType = adminSettings.llmProviderType || adminSettings.llmApiType || detectProviderType(baseUrl)
    const pool = Array.isArray(adminSettings.allowedModels) && adminSettings.allowedModels.length
        ? adminSettings.allowedModels
        : (process.env.LLM_AVAILABLE_MODELS || process.env.LLM_MODEL_NAME || '').split(',').map(m => m.trim()).filter(Boolean)
    const model = modelName || pool[0]
    const spec = normalizeProviderSpec({ providerType, baseUrl, apiKey }, { model })
    return { spec, model: spec.model }
}

async function getFeatures(req, res) {
    const flags = await getLLMFeatureFlags()
    res.json({ ...flags, allowUserSettings: isUserSettingsAllowed() })
}

// overleaf-lab: source lines around a compile-error line, for "Ask AI about
// this error". (Unchanged from the pre-BYO controller.)
async function getSourceContext(req, res) {
    const flags = await getLLMFeatureFlags()
    if (!flags.chatEnabled) {
        return res.json({ ok: false, error: 'feature_disabled' })
    }

    const projectId = req.params.Project_id
    const rawFile = String(req.query.file || '')
    const line = parseInt(req.query.line, 10)
    let radius = parseInt(req.query.radius, 10)
    if (!Number.isFinite(radius) || radius < 0) {
        radius = 15
    }
    radius = Math.min(radius, 40)

    if (!rawFile || !Number.isFinite(line) || line < 1) {
        return res.json({ ok: false, error: 'bad_request' })
    }

    const norm = p => String(p || '').replace(/^\/?compile\//, '').replace(/^\.\//, '').replace(/^\//, '')

    try {
        const docsByPath = await ProjectEntityHandler.promises.getAllDocs(projectId)
        const target = norm(rawFile)
        const targetBase = target.split('/').pop()
        let match = null
        let baseMatch = null
        for (const [docPath, value] of Object.entries(docsByPath || {})) {
            if (!value) continue
            const np = norm(docPath)
            if (np === target || np.endsWith('/' + target) || target.endsWith('/' + np)) {
                match = { path: docPath, lines: value.lines || [] }
                break
            }
            if (!baseMatch && np.split('/').pop() === targetBase) {
                baseMatch = { path: docPath, lines: value.lines || [] }
            }
        }
        match = match || baseMatch
        if (!match) {
            return res.json({ ok: false, error: 'not_found' })
        }

        const lines = match.lines
        const idx = line - 1
        const start = Math.max(0, idx - radius)
        const end = Math.min(lines.length, idx + radius + 1)
        const numbered = []
        for (let i = start; i < end; i++) {
            const marker = i === idx ? '>' : ' '
            numbered.push(`${marker} ${i + 1}: ${lines[i]}`)
        }
        return res.json({ ok: true, file: match.path, line, startLine: start + 1, snippet: numbered.join('\n') })
    }
    catch (err) {
        logger.warn({ projectId, err }, '[LLM] source-context failed')
        return res.json({ ok: false, error: 'failed' })
    }
}

async function getPrompts(req, res) {
    const prompts = await getLLMPrompts()
    res.json({
        askAiSystemPrompt: prompts.askAiSystemPrompt,
        errorPrompt: prompts.errorPrompt,
        askAiActionPrompts: prompts.askAiActionPrompts
    })
}

// overleaf-lab: AI Error Assist — suggested fix per compile log entry
// (upstream-style: explanation + exact suggested code, driven by the shared
// "Select LLM Model" choice — site lane or any BYO row).
async function compileFix(req, res) {
    const projectId = req.params.Project_id
    const userId = SessionManager.getLoggedInUserId(req.session)

    if (Settings.llm && !Settings.llm.enabled) {
        return res.status(503).json({ ok: false, error: 'llm-disabled', message: 'LLM service is disabled' })
    }
    const flags = await getLLMFeatureFlags()
    if (!flags.chatEnabled) {
        return res.status(403).json({ ok: false, error: 'feature_disabled', message: 'The LLM assist feature is disabled' })
    }

    const body = req.body || {}
    const file = String(body.file || '')
    const line = parseInt(body.line, 10)
    const level = String(body.level || 'error')
    const message = String(body.message || '').slice(0, 2000)
    // "Suggest a different fix": the previous suggestion, to be avoided.
    const hint =
        body.hint && typeof body.hint === 'object'
            ? { old: String(body.hint.old || '').slice(0, 3000), new: String(body.hint.new || '').slice(0, 3000) }
            : null
    if (!file || !Number.isFinite(line) || line < 1) {
        return res.status(400).json({ ok: false, error: 'bad_request', message: 'file and line are required' })
    }

    // overleaf-lab: the same per-user rate + daily token budget gate as chat.
    let budget
    try {
        budget = await guardLLMCall(userId)
    }
    catch (err) {
        return sendError(res, err, 429)
    }

    let lane
    let spec
    let model
    try {
        // overleaf-lab (2026-11): Error Analysis gets its own task slot.
        const resolved = await resolveLane(userId, parseModelRef(body.model), 'error')
        lane = resolved.lane
        spec = resolved.spec
        model = resolved.model
    }
    catch (err) {
        return sendError(res, err, 400)
    }

    // Numbered source window around the failing line (same matching logic
    // as /llm/source-context, inlined to keep one round trip).
    const norm = p => String(p || '').replace(/^\/?compile\//, '').replace(/^\.\//, '').replace(/^\//, '')
    let ctx
    try {
        const radius = 12
        const docsByPath = await ProjectEntityHandler.promises.getAllDocs(projectId)
        const target = norm(file)
        const targetBase = target.split('/').pop()
        let match = null
        let baseMatch = null
        for (const [docPath, value] of Object.entries(docsByPath || {})) {
            if (!value) continue
            const np = norm(docPath)
            if (np === target || np.endsWith('/' + target) || target.endsWith('/' + np)) {
                match = { path: docPath, lines: value.lines || [] }
                break
            }
            if (!baseMatch && np.split('/').pop() === targetBase) {
                baseMatch = { path: docPath, lines: value.lines || [] }
            }
        }
        match = match || baseMatch
        if (!match) {
            return res.status(404).json({ ok: false, error: 'not_found', message: 'Source file not found in the project' })
        }
        const lines = match.lines
        const idx = line - 1
        const start = Math.max(0, idx - radius)
        const end = Math.min(lines.length, idx + radius + 1)
        const numbered = []
        for (let i = start; i < end; i++) {
            numbered.push(`${i === idx ? '>' : ' '} ${i + 1}: ${lines[i]}`)
        }
        ctx = { path: match.path, line, startLine: start + 1, snippet: numbered.join('\n') }
    }
    catch (err) {
        logger.warn({ projectId, err }, '[LLM] compile-fix: source context failed')
        return res.status(500).json({ ok: false, error: 'failed', message: 'Could not read the source file' })
    }

    // The admin-editable error prompt (site lane only) sets the spirit of the
    // answer; the JSON contract from LLMCompileFix.mjs is always enforced.
    const prompts = await getLLMPrompts()
    const adminPrompt = lane === 'site' ? prompts.errorPrompt || '' : ''
    const messages = buildCompileFixMessages({
        level,
        file: ctx.path,
        line: ctx.line,
        message,
        snippet: ctx.snippet,
        hint: hint ? { old: hint.old, new: hint.new } : '',
        adminPrompt
    })

    const started = Date.now()
    logger.info(
        { projectId, lane, model, file: ctx.path, line: ctx.line },
        '[LLM] compile-fix: sending request'
    )
    // overleaf-lab: small provider retry — structured-output misses on
    // prompt-based backends ("No object generated" / empty response) are
    // flaky, so give the model one more chance before failing the request.
    let lastErr = null
    const nudged = [
        messages[0],
        {
            role: 'user',
            content:
                messages[1].content +
                '\n\nREMINDER: answer with ONLY the JSON object described in the system prompt — no fences, no prose, all four fields.'
        }
    ]
    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            const { object, usage } = await chatObject(
                spec,
                attempt === 1 ? messages : nudged,
                compileFixSchema,
                {
                    temperature: 0.4,
                    maxOutputTokens: 8000,
                    timeoutMs: 180000,
                    usageMeta: { userId, action: 'compile-fix', lane, projectId } // overleaf-lab (usage meter)
                }
            )
            const clean = validateCompileFixObject(object)
            budget.record(usage?.outputTokens)
            logger.info(
                { projectId, lane, model, attempt, duration: `${Date.now() - started}ms`, chars: clean.suggestedNew.length },
                '[LLM] compile-fix: ok'
            )
            return res.json({
                ok: true,
                file: ctx.path,
                line: ctx.line,
                startLine: ctx.startLine,
                snippet: ctx.snippet,
                explanation: clean.explanation,
                suggestedOld: clean.suggestedOld,
                suggestedNew: clean.suggestedNew,
                span: clean.span,
                lane,
                model
            })
        }
        catch (err) {
            lastErr = err
            const flaky = err && (err.code === 'empty-response' || /did not match schema|No object generated/i.test(err.message || ''))
            if (flaky && attempt < 2) {
                logger.warn({ projectId, err: err?.message }, '[LLM] compile-fix: retrying (structured-output miss)')
                continue
            }
            break
        }
    }
    if (lastErr && lastErr.code === 'llm-bad-fix') {
        return res.status(422).json({
            ok: false,
            error: 'llm-bad-fix',
            message: 'The model did not return a usable suggestion — please try again.'
        })
    }
    if (lastErr && (lastErr.code === 'empty-response' || /did not match schema|No object generated/i.test(lastErr.message || ''))) {
        return res.status(422).json({
            ok: false,
            error: 'llm-bad-fix',
            message: 'The model did not return a usable suggestion — please try again.'
        })
    }
    sendError(res, lastErr, 502)
}

// overleaf-lab: whole-document generators (title/abstract/keywords).
// Budgets raised for reasoning models (thinking consumes output budget).
const GENERATOR_TYPES = {
    title: {
        maxOutputTokens: 4000,
        temperature: 0.4,
        instruction:
            'Write ONE concise, grammatically correct title for the document below, in the same language as the document\'s main body text. ' +
            'Return ONLY the title text — no quotes, no numbering, no explanation.'
    },
    abstract: {
        maxOutputTokens: 8000,
        temperature: 0.3,
        instruction:
            'Write a structured abstract (150–250 words) for the document below, in the same language as the document\'s main body text: ' +
            'purpose, methods, key results/findings, and conclusion in that order. ' +
            'Return ONLY the abstract text — no heading, no quotes, no explanation.'
    },
    keywords: {
        maxOutputTokens: 4000,
        temperature: 0.2,
        instruction:
            'Generate 5–8 keyword phrases for the document below that capture its ' +
            'core topics, methods, and domain, in the same language as the document\'s main body text. Return ONLY the keywords, ' +
            'separated by commas, in order of importance.'
    }
}

async function generateDocument(req, res) {
    const { type, model: modelRefString } = req.body
    const projectId = req.params.Project_id
    const userId = SessionManager.getLoggedInUserId(req.session)

    const generator = GENERATOR_TYPES[type]
    if (!generator) {
        return res.status(400).json({
            ok: false,
            error: 'llm-invalid',
            message: `Unknown generator type. Expected one of: ${Object.keys(GENERATOR_TYPES).join(', ')}`
        })
    }
    if (Settings.llm && !Settings.llm.enabled) {
        return res.status(503).json({ ok: false, error: 'llm-disabled', message: 'LLM service is disabled' })
    }
    const flags = await getLLMFeatureFlags()
    if (!flags.chatEnabled) {
        return res.status(403).json({ ok: false, error: 'feature_disabled', message: 'The chat feature is disabled' })
    }

    let budget
    try {
        budget = await guardLLMCall(userId)
    }
    catch (err) {
        return sendError(res, err, 429)
    }

    let lane
    let spec
    let model
    try {
        const resolved = await resolveLane(userId, parseModelRef(modelRefString))
        lane = resolved.lane
        spec = resolved.spec
        model = resolved.model
    }
    catch (err) {
        // overleaf-lab: a broken/stale BYO row must not hard-fail the whole-document
        // generators when this deployment also has a working site backend (parity
        // with the completion endpoint's lane chain). resolveSiteLane() throws
        // when no site backend is configured, so this is a safe no-op otherwise.
        const site = await resolveSiteLane()
            .then(s => ({ ...s, lane: 'site' }))
            .catch(() => null)
        if (site) {
            lane = site.lane
            spec = site.spec
            model = site.model
            logger.info({ userId, err: err?.message }, '[LLM] generate: user lane failed, using site lane')
        }
        if (!lane) {
            return res.status(503).json({ ok: false, error: err?.code || 'llm-disabled', message: err?.message || 'No LLM backend is configured' })
        }
    }

    try {
        // Whole-project document text (LaTeX sources first), with per-file and
        // total caps so worst-case prompts fit typical context windows.
        const docsByPath = (await ProjectEntityHandler.promises.getAllDocs(projectId)) || {}
        const entries = Object.entries(docsByPath).filter(([, v]) => v && Array.isArray(v.lines))
        const isTex = p => /\.(tex|sty|cls|bib)$/i.test(String(p))
        entries.sort((a, b) => Number(isTex(b[0])) - Number(isTex(a[0])))

        const perFileCap = 60000
        const totalCap = 240000
        let docText = ''
        const included = []
        for (const [docPath, value] of entries) {
            if (docText.length >= totalCap) break
            const text = (value.lines || []).join('\n')
            if (!text.trim()) continue
            const clipped = text.length > perFileCap ? text.slice(0, perFileCap) + '\n[...truncated...]' : text
            docText += `===== FILE: ${docPath} =====\n${clipped}\n\n`
            included.push(docPath)
        }
        if (!docText.trim()) {
            return res.status(422).json({ ok: false, error: 'no_document', message: 'The project contains no readable document file' })
        }

        const systemPrompt = lane === 'site' ? (await getSystemPrompt()) || '' : ''
        const templates = (await getLLMPrompts()).askAiActionPrompts || {}
        const styleGuidance = templates[type] ? `STYLE GUIDANCE from the author's template: ${templates[type]}\n\n` : ''

        const messages = []
        if (systemPrompt) messages.push({ role: 'system', content: systemPrompt })
        messages.push({ role: 'user', content: `${styleGuidance}${generator.instruction}\n\nDOCUMENT:\n${docText}` })

        // overleaf-lab (owner bug report #2): several instruct models answer
        // document-generation requests with a FABRICATED TOOL CALL such as
        // `tool call: get_keywords_from_document("/main.tex")` instead of the
        // requested text. Mitigations: a hard no-tool-call instruction on
        // every attempt, one nudge-retry when the output still looks like a
        // tool call, then a clear, actionable error (never show the gibberish
        // as the "result").
        const NO_TOOLS =
            ' Do not call, name, or simulate any tool, function, or API (never output lines such as "tool call: ..." or "function ..."). Answer directly with the requested text only.'
        messages[messages.length - 1].content += NO_TOOLS

        const started = Date.now()
        let text = ''
        let usage = null
        const baseUserContent = messages[messages.length - 1].content
        const prefix = messages.slice(0, -1)
        let toolish = false
        for (let attempt = 1; attempt <= 2 && !text; attempt++) {
            const userContent =
                attempt === 1
                    ? baseUserContent
                    : `${baseUserContent}\n\nReminder (second attempt): produce the plain ${type} text now. No tool calls, no function names, no placeholders, no code fences.`
            const r = await chatText(spec, [...prefix, { role: 'user', content: userContent }], {
                maxOutputTokens: generator.maxOutputTokens,
                temperature: generator.temperature,
                timeoutMs: 300000,
                usageMeta: { userId, action: `generate-${type}`, lane, projectId } // overleaf-lab (usage meter)
            })
            usage = r.usage || usage
            toolish = /^(tool|function)\s*call\b|^\s*get_[a-z0-9_]+\(/im.test((r.text || '').trim())
            if (!toolish) {
                text = (r.text || '').trim()
            }
        }
        if (toolish) {
            throw Object.assign(
                new Error(
                    'The model answered with a tool-call-like response instead of the requested text. Choose a different model (File → Select LLM Model) and try again.'
                ),
                { code: 'llm-tool-call-output' }
            )
        }
        assertNonEmpty(text)
        budget.record(usage?.outputTokens)

        logger.info(
            { projectId, lane, model, type, files: included.length, chars: docText.length, duration: `${Date.now() - started}ms` },
            '[LLM] generateDocument: ok'
        )
        res.json({ ok: true, type, output: text.trim(), model, lane, files: included.length })
    }
    catch (err) {
        sendError(res, err, 502)
    }
}


export default {
    chat: expressify(chat),
    getModels: expressify(getModels),
    completion: expressify(completion),
    getFeatures: expressify(getFeatures),
    getSourceContext: expressify(getSourceContext),
    getPrompts: expressify(getPrompts),
    compileFix: expressify(compileFix),
    generateDocument: expressify(generateDocument)
}
