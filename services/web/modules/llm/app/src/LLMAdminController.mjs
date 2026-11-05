import logger from '@overleaf/logger'
import fs from 'node:fs'
import path from 'node:path'
import { getUsageSummary } from './LLMUsage.mjs'; // overleaf-lab (usage meter)
import { User } from '../../../../app/src/models/User.mjs' // overleaf-lab (2026-11-05): per-user MCP override (named export, 4 levels up)
import { z } from 'zod'
import { expressify } from '@overleaf/promise-utils'
// overleaf-lab (2026-11-05, owner request): the MCP service listing for the
// admin page comes from the mcp-server module's own builders (single source
// of truth — LlmBridge proves cross-module web imports build fine).
import { listMcpServices } from '../../../mcp-server/app/src/McpController.mjs'
import { encryptSecret, decryptSecret } from './LLMCrypto.mjs' // overleaf-lab: at-rest encryption of admin API key
import { listModels, detectProviderType } from './LLMClient.mjs' // overleaf-lab: AI-SDK provider seam
import {
  DEFAULT_ASK_AI_SYSTEM_PROMPT,
  DEFAULT_ERROR_PROMPT,
  DEFAULT_REVIEW_SYSTEM_PROMPT,
  DEFAULT_WORKBENCH_SYSTEM_PROMPT,
  DEFAULT_ASK_AI_ACTION_PROMPTS,
  mergeActionPrompts,
} from './LLMPrompts.mjs' // overleaf-lab: editable prompt defaults + merge helper

// Persist admin LLM settings in the same volume used by Overleaf data
const ADMIN_SETTINGS_PATH = process.env.LLM_ADMIN_SETTINGS_PATH ||
  '/var/lib/overleaf/data/llm-admin-settings.json'

// overleaf-lab: fallback for the review answer budget when the admin has not set one.
// Mirrors LLMComplianceController's REVIEW_MAX_TOKENS default (env override, else
// 12000). Duplicated here on purpose: importing it would make the two controllers
// import each other, since the compliance one already imports this module.
const DEFAULT_REVIEW_MAX_TOKENS =
  Number.parseInt(process.env.LLM_REVIEW_MAX_TOKENS, 10) > 0
    ? Number.parseInt(process.env.LLM_REVIEW_MAX_TOKENS, 10)
    : 12000

function readAdminSettings() {
  try {
    const raw = fs.readFileSync(ADMIN_SETTINGS_PATH, 'utf8')
    return JSON.parse(raw)
  } catch (err) {
    if (err.code === 'ENOENT') return {}
    logger.warn({ err, path: ADMIN_SETTINGS_PATH }, '[LLM] Could not read admin settings file')
    return {}
  }
}

function writeAdminSettings(data) {
  try {
    fs.mkdirSync(path.dirname(ADMIN_SETTINGS_PATH), { recursive: true })
    // F9: atomic write — temp file in the same directory + rename (POSIX
    // rename is atomic) fixes torn reads; explicit chmod also corrects the
    // mode of an EXISTING file created with looser permissions.
    const tmp = `${ADMIN_SETTINGS_PATH}.tmp-${process.pid}-${Date.now()}`
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2))
    fs.chmodSync(tmp, 0o600)
    fs.renameSync(tmp, ADMIN_SETTINGS_PATH)
  } catch (err) {
    logger.error({ err, path: ADMIN_SETTINGS_PATH }, '[LLM] Could not write admin settings file')
    throw err
  }
}

// Exported so other modules and tests can share the SAME admin settings file —
// single source of truth for llmDisabledByAdmin and the LLM lane settings.
export { ADMIN_SETTINGS_PATH, readAdminSettings, writeAdminSettings }

// overleaf-lab: the shared LLM backend can be configured either via this admin
// settings JSON file OR via environment variables (LLM_API_URL / LLM_API_KEY /
// LLM_MODEL_NAME). The chat already falls back to env; expose the same fallback
// here so the admin page and the model scan reflect an env-only configuration
// instead of looking empty.
function envModelList() {
  const raw = process.env.LLM_AVAILABLE_MODELS || process.env.LLM_MODEL_NAME || ''
  return raw
    .split(',')
    .map(m => m.trim())
    .filter(m => m.length > 0)
}

// Effective settings for display: the JSON value, else the env fallback, plus
// flags telling the UI which values are inherited from the environment. The API
// key value is never returned, only whether one is set.
async function buildDisplaySettings() {
  const settings = readAdminSettings()
  const envModels = envModelList()
  const jsonHasModels =
    Array.isArray(settings.allowedModels) && settings.allowedModels.length > 0
  return {
    systemPrompt: settings.systemPrompt || '',
    llmApiUrl: settings.llmApiUrl || process.env.LLM_API_URL || '',
    llmApiType:
      settings.llmApiType ||
      process.env.LLM_API_TYPE ||
      detectProviderType(settings.llmApiUrl || process.env.LLM_API_URL),
    hasLlmApiKey: !!(settings.llmApiKey || process.env.LLM_API_KEY),
    allowedModels: jsonHasModels ? settings.allowedModels : envModels,
    // overleaf-lab: item 8 (PR decision) — the FULL fetched model list; allowedModels
    // is the checked/enabled subset. The UI keeps unchecked models visible so an
    // admin can re-enable them without rescan.
    knownModels:
      Array.isArray(settings.knownModels) && settings.knownModels.length > 0
        ? settings.knownModels
        : jsonHasModels
          ? settings.allowedModels
          : envModels,
    completionModel: settings.completionModel || '',
    llmApiUrlFromEnv: !settings.llmApiUrl && !!process.env.LLM_API_URL,
    llmApiTypeFromEnv: !settings.llmApiType && !!process.env.LLM_API_TYPE,
    hasApiKeyFromEnv: !settings.llmApiKey && !!process.env.LLM_API_KEY,
    allowedModelsFromEnv: !jsonHasModels && envModels.length > 0,
    // overleaf-lab: document compliance review settings
    complianceRubrics: Array.isArray(settings.complianceRubrics) ? settings.complianceRubrics : [],
    reviewModel: settings.reviewModel || '',
    maxContextTokens: settings.maxContextTokens || 32000,
    reviewMaxTokens: settings.reviewMaxTokens || DEFAULT_REVIEW_MAX_TOKENS,
    // overleaf-lab: per-feature enable flags; absent field defaults to true so
    // existing installs keep every feature on.
    chatEnabled: settings.chatEnabled !== false,
    completionEnabled: settings.completionEnabled !== false,
    reviewEnabled: settings.reviewEnabled !== false,
    llmDisabledByAdmin: settings.llmDisabledByAdmin === true,
    // overleaf-lab (2026-11-05): MCP switch defaults to ON when unset.
    mcpEnabled: settings.mcpEnabled !== false,
    // overleaf-lab (2026-11-05): per-service on/off — surface with all-defaults
    // filled in (absent = enabled) so the admin page can render the full list.
    mcpServices: {
      projects: (settings.mcpServices || {}).projects !== false,
      compile: (settings.mcpServices || {}).compile !== false,
      files: (settings.mcpServices || {}).files !== false,
      comments: (settings.mcpServices || {}).comments !== false,
      chat: (settings.mcpServices || {}).chat !== false,
      versions: (settings.mcpServices || {}).versions !== false,
      track_changes: (settings.mcpServices || {}).track_changes !== false,
    },
    // overleaf-lab: editable prompt overrides. Show the EFFECTIVE value (the
    // admin override when set, else the shipped default) plus the pristine
    // defaults so the admin page can offer a reset-to-default button.
    askAiSystemPrompt: settings.askAiSystemPrompt || DEFAULT_ASK_AI_SYSTEM_PROMPT,
    errorPrompt: settings.errorPrompt || DEFAULT_ERROR_PROMPT,
    reviewSystemPrompt: settings.reviewSystemPrompt || DEFAULT_REVIEW_SYSTEM_PROMPT,
    // overleaf-lab (merge phase 4): the unified AI assistant (workbench) prompt.
    workbenchSystemPrompt: settings.workbenchSystemPrompt || DEFAULT_WORKBENCH_SYSTEM_PROMPT,
    askAiActionPrompts: mergeActionPrompts(settings.askAiActionPrompts),
    promptDefaults: {
      askAiSystemPrompt: DEFAULT_ASK_AI_SYSTEM_PROMPT,
      errorPrompt: DEFAULT_ERROR_PROMPT,
      reviewSystemPrompt: DEFAULT_REVIEW_SYSTEM_PROMPT,
      workbenchSystemPrompt: DEFAULT_WORKBENCH_SYSTEM_PROMPT,
      askAiActionPrompts: DEFAULT_ASK_AI_ACTION_PROMPTS,
    },
  }
}

async function adminSettingsPage(req, res) {
  const pugPath = new URL('../../app/views/llm-admin-settings.pug', import.meta.url).pathname
  res.render(pugPath, await buildDisplaySettings())
}

async function getAdminSettings(req, res) {
  res.json(await buildDisplaySettings())
}

const llmSettingsSchema = z.object({
  // overleaf-lab: optional so a save that omits it (or sends '') still works; the
  // chat falls back to its own language instruction when no prompt is set.
  systemPrompt: z.string().max(4000).optional(),

  llmApiUrl: z.string().optional(),
  llmApiType: z.string().optional(),
  llmApiKey: z.string().optional(),
  clearLlmApiKey: z.boolean().optional(),

  allowedModels: z.array(z.string()).optional(),
  // overleaf-lab: item 8 — the full fetched model list (checked subset = allowedModels)
  knownModels: z.array(z.string()).optional(),

  completionModel: z.string().optional(),

  complianceRubrics: z.array(z.unknown()).optional(),

  reviewModel: z.string().optional(),

  maxContextTokens: z.number().optional(),
  reviewMaxTokens: z.number().optional(),

  chatEnabled: z.boolean().optional(),
  completionEnabled: z.boolean().optional(),
  reviewEnabled: z.boolean().optional(),

  llmDisabledByAdmin: z.boolean().optional(),

  // overleaf-lab (owner request 2026-11-05): MCP service switch under the
  // LLM settings page. True (default) = MCP endpoint available; false = every
  // MCP call gets a clear 503. Per-user overrides live on the User document
  // (User.llmMcpEnabled) and are managed from the admin user account card.
  mcpEnabled: z.boolean().optional(),
  // overleaf-lab (owner request 2026-11-05): per-service on/off (systemwide).
  // Object keyed by service key (projects|compile|files|comments|chat|
  // versions|track_changes); false = that service is removed for EVERY user.
  // Absent/unset keys default to enabled, so existing installs keep it all.
  mcpServices: z.record(z.boolean()).optional(),

  // overleaf-lab: editable prompt overrides. Each scalar prompt, when provided,
  // must be a string capped at 8000 chars. An empty string is allowed and means
  // "fall back to default" (buildDisplaySettings/getLLMPrompts use `|| DEFAULT`).
  askAiSystemPrompt: z.string().max(8000).optional(),
  errorPrompt: z.string().max(8000).optional(),
  reviewSystemPrompt: z.string().max(8000).optional(),
  // overleaf-lab (merge phase 4): unified assistant (workbench) prompt override.
  workbenchSystemPrompt: z.string().max(8000).optional(),

  // overleaf-lab: action prompts, when provided, must be a plain (non-array) object.
  askAiActionPrompts: z
    .record(z.string(), z.string())
    .optional(),
})

async function saveAdminSettings(req, res) {
  const safeBody = llmSettingsSchema.safeParse(req.body)
  if (!safeBody.success) {
    const errors = safeBody.error.issues.map(issue => ({
      field: issue.path.join('.'),
      message: issue.message,
    }))
    logger.error( { errors }, 'Bad admin settings')
    // F8: return ALL validation errors so the UI can surface them.
    return res.status(400).json({
      ok: false,
      error: safeBody.error.issues[0].message,
      errors,
    })
  }

  const {
    systemPrompt,
    llmApiUrl,
    llmApiType,
    llmApiKey,
    clearLlmApiKey,
    allowedModels,
    knownModels,
    completionModel,
    complianceRubrics,
    reviewModel,
    maxContextTokens,
    reviewMaxTokens,
    chatEnabled,
    completionEnabled,
    reviewEnabled,
    llmDisabledByAdmin,
    mcpEnabled, // overleaf-lab (2026-11-05): MCP service switch
    mcpServices, // overleaf-lab (2026-11-05): per-service on/off (systemwide)
    // overleaf-lab: editable prompt overrides.
    askAiSystemPrompt,
    errorPrompt,
    reviewSystemPrompt,
    workbenchSystemPrompt,
    askAiActionPrompts,
  } = safeBody.data

  const existing = readAdminSettings()

  // overleaf-lab: sanitize each rubric and cap the count via the shared helper
  // (same rules as the per-user rubric save). When not provided, keep the
  // existing rubrics untouched.
  const sanitizedRubricsInput = sanitizeComplianceRubrics(complianceRubrics)
  // overleaf-lab: validate the RAW input so an over-long scan-patterns block
  // fails loudly (the sanitizer would otherwise silently truncate it).
  const rubricError = validateComplianceRubrics(Array.isArray(complianceRubrics) ? complianceRubrics : [])
  if (rubricError) {
    return res.status(400).json({ error: rubricError })
  }
  const sanitizedRubrics = sanitizedRubricsInput === null
    ? (Array.isArray(existing.complianceRubrics) ? existing.complianceRubrics : [])
    : sanitizedRubricsInput

  // overleaf-lab: clamp the context window to a sane range; keep existing (or the
  // 32000 default) when not provided.
  let sanitizedMaxContextTokens
  if (maxContextTokens !== undefined) {
    const parsed = parseInt(maxContextTokens, 10)
    sanitizedMaxContextTokens = Number.isNaN(parsed)
      ? existing.maxContextTokens || 32000
      : Math.min(1000000, Math.max(2000, parsed))
  } else {
    sanitizedMaxContextTokens = existing.maxContextTokens || 32000
  }

  // overleaf-lab: clamp the review answer budget. This is the model's max_tokens for
  // the report AND the room reserved for it in the context check, so it is bounded
  // well below any real context window.
  let sanitizedReviewMaxTokens
  if (reviewMaxTokens !== undefined) {
    const parsed = parseInt(reviewMaxTokens, 10)
    sanitizedReviewMaxTokens = Number.isNaN(parsed)
      ? existing.reviewMaxTokens || DEFAULT_REVIEW_MAX_TOKENS
      : Math.min(128000, Math.max(500, parsed))
  } else {
    sanitizedReviewMaxTokens = existing.reviewMaxTokens || DEFAULT_REVIEW_MAX_TOKENS
  }

  // overleaf-lab: scan-pattern validation moved to the shared helper above
  // (validateComplianceRubrics — same 4000-char cap + per-line RegExp check).

  // overleaf-lab: sanitize the action prompt overrides. When provided, keep only
  // known keys with string values, each capped at 4000 chars. When not provided,
  // keep the existing object untouched.
  let sanitizedActionPrompts
  if (askAiActionPrompts !== undefined) {
    sanitizedActionPrompts = {}
    for (const key of Object.keys(DEFAULT_ASK_AI_ACTION_PROMPTS)) {
      const val = askAiActionPrompts[key]
      if (typeof val === 'string') {
        sanitizedActionPrompts[key] = val.slice(0, 4000)
      }
    }
  } else {
    sanitizedActionPrompts =
      existing.askAiActionPrompts &&
      typeof existing.askAiActionPrompts === 'object' &&
      !Array.isArray(existing.askAiActionPrompts)
        ? existing.askAiActionPrompts
        : {}
  }

  const updatedSettings = {
    ...existing,
    systemPrompt: typeof systemPrompt === 'string' ? systemPrompt : (existing.systemPrompt || ''),
    llmApiUrl: typeof llmApiUrl === 'string' ? llmApiUrl : (existing.llmApiUrl || ''),
    llmApiType: typeof llmApiType === 'string' ? llmApiType : (existing.llmApiType || ''),
    allowedModels: Array.isArray(allowedModels) ? allowedModels : existing.allowedModels || [],
    knownModels: Array.isArray(knownModels)
      ? knownModels
      : Array.isArray(existing.knownModels)
        ? existing.knownModels
        : Array.isArray(existing.allowedModels)
          ? existing.allowedModels
          : [],
    completionModel: typeof completionModel === 'string' ? completionModel : (existing.completionModel || ''),
    complianceRubrics: sanitizedRubrics,
    reviewModel: typeof reviewModel === 'string' ? reviewModel : (existing.reviewModel || ''),
    maxContextTokens: sanitizedMaxContextTokens,
    reviewMaxTokens: sanitizedReviewMaxTokens,
    // overleaf-lab: omitted flag keeps the existing value (default true).
    chatEnabled: typeof chatEnabled === 'boolean' ? chatEnabled : (existing.chatEnabled !== false),
    completionEnabled: typeof completionEnabled === 'boolean' ? completionEnabled : (existing.completionEnabled !== false),
    reviewEnabled: typeof reviewEnabled === 'boolean' ? reviewEnabled : (existing.reviewEnabled !== false),
    llmDisabledByAdmin: typeof llmDisabledByAdmin === 'boolean' ? llmDisabledByAdmin : (existing.llmDisabledByAdmin === true),
    // overleaf-lab (2026-11-05): MCP service switch — default ON when never set.
    mcpEnabled: typeof mcpEnabled === 'boolean' ? mcpEnabled : (existing.mcpEnabled !== false),
    // overleaf-lab (2026-11-05): per-service on/off — merge over the defaults
    // (all true) so a partial save can't wipe services it didn't mention.
    mcpServices: { ...(existing.mcpServices || {}), ...((mcpServices && typeof mcpServices === 'object') ? mcpServices : {}) },
    // overleaf-lab: editable prompt overrides. An empty string is stored as-is
    // and later falls back to the default via `|| DEFAULT`.
    askAiSystemPrompt: typeof askAiSystemPrompt === 'string' ? askAiSystemPrompt : (existing.askAiSystemPrompt || ''),
    errorPrompt: typeof errorPrompt === 'string' ? errorPrompt : (existing.errorPrompt || ''),
    reviewSystemPrompt: typeof reviewSystemPrompt === 'string' ? reviewSystemPrompt : (existing.reviewSystemPrompt || ''),
    // overleaf-lab (merge phase 4): same empty-string-means-default rule.
    workbenchSystemPrompt: typeof workbenchSystemPrompt === 'string' ? workbenchSystemPrompt : (existing.workbenchSystemPrompt || ''),
    askAiActionPrompts: sanitizedActionPrompts,
  }

  if (clearLlmApiKey) {
    updatedSettings.llmApiKey = '' // overleaf-lab: explicit "remove stored key" from the admin UI
  } else if (typeof llmApiKey === 'string' && llmApiKey.trim().length > 0) {
    updatedSettings.llmApiKey = encryptSecret(llmApiKey.trim()) // overleaf-lab: encrypt admin key at rest
  }

  await writeAdminSettings(updatedSettings)
  logger.info({
    length: (updatedSettings.systemPrompt || '').length,
    llmApiUrl: !!updatedSettings.llmApiUrl,
    llmApiType: !!updatedSettings.llmApiType,
    hasLlmApiKey: !!updatedSettings.llmApiKey,
    allowedModels: updatedSettings.allowedModels?.length || 0,
    knownModels: updatedSettings.knownModels?.length || 0,
    llmDisabledByAdmin: updatedSettings.llmDisabledByAdmin,
  }, '[LLM] Admin settings updated')

  res.json({ success: true })
}

// Exported so LLMChatController can prepend the admin system prompt
// overleaf-lab (owner request 2026-11-05): per-user MCP service override.
// Tri-state: 'default' follows the site switch, 'enabled' force-allows,
// 'disabled' denies (403 at the MCP router). Stored on User.llmMcpEnabled.
const MCP_USER_MODES = ['default', 'enabled', 'disabled']

function mcpModeFromUserDoc(doc) {
  if (!doc) {
    return 'default'
  }
  if (doc.llmMcpEnabled === true) {
    return 'enabled'
  }
  if (doc.llmMcpEnabled === false) {
    return 'disabled'
  }
  return 'default'
}

async function getMcpUserMode(req, res) {
  const doc = await User.findOne({ _id: req.params.userId }).select('llmMcpEnabled')
  res.json({ ok: true, mode: mcpModeFromUserDoc(doc) })
}

// overleaf-lab (2026-11-05, owner request): the available MCP services —
// rendered in the admin settings → MCP service section. Read-only listing;
// the gate itself is unchanged.
async function getMcpTools(req, res) {
  let services = []
  try {
    services = listMcpServices()
  } catch {
    services = []
  }
  // overleaf-lab (2026-11-05, owner request): include the per-service on/off
  // state so the admin page can render each service with an enable/disable
  // control plus an info affordance (description) of what it does.
  const settings = readAdminSettings()
  const off = (settings || {}).mcpServices || {}
  const out = services.map(s => ({
    key: s.key,
    label: s.label,
    description: s.description || '',
    enabled: off[s.key] !== false,
    tools: s.tools,
  }))
  res.json({ ok: true, services: out })
}

async function saveMcpUserMode(req, res) {
  const mode = typeof req.body?.mode === 'string' ? req.body.mode : ''
  if (!MCP_USER_MODES.includes(mode)) {
    return res.status(400).json({
      ok: false,
      error: 'bad-mode',
      message: `mode must be one of: ${MCP_USER_MODES.join(', ')}`,
    })
  }
  const value = mode === 'enabled' ? true : mode === 'disabled' ? false : null
  const updated = await User.findByIdAndUpdate(
    req.params.userId,
    { $set: { llmMcpEnabled: value } },
    { new: true },
  ).select('llmMcpEnabled')
  if (!updated) {
    return res.status(404).json({ ok: false, error: 'not-found', message: 'User not found' })
  }
  res.json({ ok: true, mode: mcpModeFromUserDoc(updated) })
}

export async function getSystemPrompt() {
  const settings = readAdminSettings()
  return settings.systemPrompt || null
}

export async function getAdminLLMSettings() {
  const settings = readAdminSettings()
  // overleaf-lab: fall back to env so the model scan / connection-check and the
  // chat share the same effective config (mirrors buildDisplaySettings above).
  const jsonHasModels =
      Array.isArray(settings.allowedModels) && settings.allowedModels.length > 0
  // overleaf-lab: the stored admin key is encrypted at rest; decrypt before use.
  // decryptSecret returns legacy plaintext (no enc:v1: prefix) unchanged.
  const jsonKey = settings.llmApiKey ? decryptSecret(settings.llmApiKey) : ''
  return {
    llmApiUrl: settings.llmApiUrl || process.env.LLM_API_URL || null,
    llmApiType:
      settings.llmApiType ||
      process.env.LLM_API_TYPE ||
      detectProviderType(settings.llmApiUrl || process.env.LLM_API_URL),
    llmApiKey: jsonKey || process.env.LLM_API_KEY || null,
    allowedModels: jsonHasModels ? settings.allowedModels : envModelList(),
    completionModel: settings.completionModel || '',
    // overleaf-lab: document compliance review settings
    reviewModel: settings.reviewModel || '',
    maxContextTokens: settings.maxContextTokens || 32000,
    reviewMaxTokens: settings.reviewMaxTokens || DEFAULT_REVIEW_MAX_TOKENS,
    // overleaf-lab: per-feature enable flags (absent field defaults to true).
    chatEnabled: settings.chatEnabled !== false,
    completionEnabled: settings.completionEnabled !== false,
    reviewEnabled: settings.reviewEnabled !== false,
  }
}

// overleaf-lab: per-feature enable flags for the chat, inline completion, and
// compliance review features. An absent field defaults to true so existing
// installs keep every feature on. Used for backend enforcement across the
// project-scoped controllers and the user settings page.
export async function getLLMFeatureFlags() {
  const s = readAdminSettings()
  return {
    chatEnabled: s.chatEnabled !== false,
    completionEnabled: s.completionEnabled !== false,
    reviewEnabled: s.reviewEnabled !== false,
  }
}

// overleaf-lab: exposed so the compliance controller can load the configured
// rubrics (readAdminSettings already handles the missing-file case).
export async function getComplianceRubrics() {
  const settings = readAdminSettings()
  return Array.isArray(settings.complianceRubrics) ? settings.complianceRubrics : []
}

// overleaf-lab (2026-08-27): shared rubric hygiene, used by BOTH the admin save
// and the per-user compliance rubric save (owner request: rubrics became
// user-scoped in /user/llm-settings — same caps, same validation).
// Sanitizes a rubric list (drops entries without id/name, caps text fields,
// caps the list). Returns null when `list` is not an array (caller keeps the
// existing value).
export function sanitizeComplianceRubrics(list) {
  if (!Array.isArray(list)) return null
  return list
    .map(r => ({
      id: String((r && r.id) || ''),
      name: String((r && r.name) || '').slice(0, 200),
      guidelines: String((r && r.guidelines) || '').slice(0, 20000),
      // overleaf-lab: per-rubric mechanical scans ("Label :: regex" per
      // line); policy lives with the rubric it verifies, never in code.
      scanPatterns: String((r && r.scanPatterns) || '').slice(0, 4000),
    }))
    .filter(r => r.id && r.name)
    .slice(0, 50)
}

// overleaf-lab: validates each rubric's scan patterns ("Label :: regex" per
// line) so a broken regex fails at SAVE time, not as a silently hint-less
// review. Returns the first error message, or null when everything parses
// (reviewer-side parsing skips invalid lines anyway — defense in depth).
export function validateComplianceRubrics(list) {
  if (!Array.isArray(list)) return null
  for (const r of list) {
    const patternsText = r && typeof r.scanPatterns === 'string' ? r.scanPatterns : ''
    if (patternsText.length > 4000) {
      return `Scan patterns of rubric "${(r && r.name) || '?'}" must be 4000 characters or fewer`
    }
    for (const rawLine of patternsText.split('\n')) {
      const line = rawLine.trim()
      if (!line) continue
      const sep = line.indexOf('::')
      const body = (sep === -1 ? line : line.slice(sep + 2)).trim()
      if (!body) continue
      // overleaf-lab (harden): cap each pattern — these are compiled as regexes
      // per review run (admin AND user supplied); a few-kilobyte pattern is
      // already pathological and a ReDoS candidate.
      if (body.length > 200) {
        return `Scan pattern in rubric "${(r && r.name) || '?'}" is too long (max 200 characters)`
      }
      try {
        // eslint-disable-next-line no-new
        new RegExp(body, 'i')
      } catch (err) {
        return `Invalid scan pattern regex in rubric "${(r && r.name) || '?'}": ${body.slice(0, 80)}`
      }
    }
  }
  return null
}

// overleaf-lab: resolve the EFFECTIVE editable prompts (admin override when set,
// else the shipped default). Consumed by the compliance reviewer and the
// project-scoped GET /llm/prompts endpoint so the frontend and backend agree.
export async function getLLMPrompts() {
  const s = readAdminSettings()
  return {
    askAiSystemPrompt: s.askAiSystemPrompt || DEFAULT_ASK_AI_SYSTEM_PROMPT,
    errorPrompt: s.errorPrompt || DEFAULT_ERROR_PROMPT,
    reviewSystemPrompt: s.reviewSystemPrompt || DEFAULT_REVIEW_SYSTEM_PROMPT,
    // overleaf-lab (merge phase 4): workbench assistant prompt, same resolution.
    workbenchSystemPrompt: s.workbenchSystemPrompt || DEFAULT_WORKBENCH_SYSTEM_PROMPT,
    askAiActionPrompts: mergeActionPrompts(s.askAiActionPrompts),
  }
}

async function checkAdminLLMConnection(req, res) {
  const { apiUrl, apiKey, apiType } = req.body
  const adminSettings = await getAdminLLMSettings()
  const llmApiUrl = apiUrl || adminSettings.llmApiUrl
  const llmApiKey = apiKey || adminSettings.llmApiKey
  const llmApiType = apiType || adminSettings.llmApiType || detectProviderType(llmApiUrl)

  const testModel =
    adminSettings.allowedModels[0] ||
    (process.env.LLM_MODEL_NAME || '').split(',')[0].trim()

  if (!llmApiUrl) {
    return res.status(400).json({
      success: false,
      error: 'LLM API URL is required',
    })
  }

  // overleaf-lab: PR decision (item 7) — "testing the connection" IS a
  // successful model-list fetch: it proves reachability, auth, and that the
  // backend serves at least one model, in ONE round trip. The first configured
  // model (if any) must be in the list, which catches typos/stopped models.
  const spec = normalizeSpecFor(llmApiUrl, llmApiKey, llmApiType, testModel || 'probe')

  try {
    const { ids } = await listModels(spec, { timeoutMs: 60000 })

    if (testModel && !ids.includes(testModel)) {
      logger.warn({ testModel, ids: ids.length }, '[LLM] Admin check: configured model not in backend list')
      return res.status(404).json({
        success: false,
        error: `Model "${testModel}" is not available on this backend`,
        status: 404,
        models: ids,
      })
    }

    res.json({ success: true, message: 'Connection successful', models: ids })
  } catch (err) {
    const status = err.code === 'auth' ? 401 : (err.status || 500)
    logger.error({ err: err.message, code: err.code }, '[LLM] Admin connection check failed')
    res.status(status).json({
      success: false,
      error: 'LLM connection failed',
      status,
      details: err.message,
      models: [],
    })
  }
}

function normalizeSpecFor(baseUrl, apiKey, providerType, model) {
  const type = providerType || detectProviderType(baseUrl)
  const base = String(baseUrl || '').replace(/\/+$/, '')
  const baseForType = type === 'anthropic' ? base.replace(/\/v\d+$/, '') : base
  return { providerType: type, baseUrl: baseForType, apiKey: apiKey || '', model }
}

async function scanAdminModels(req, res) {
  // overleaf-lab: credentials come from the POST body, never the URL query
  // string (keys in query strings leak into access logs).
  const { apiUrl, apiKey, apiType } = req.body
  const adminSettings = await getAdminLLMSettings()
  const llmApiUrl = apiUrl || adminSettings.llmApiUrl
  const llmApiKey = apiKey || adminSettings.llmApiKey
  const llmApiType = apiType || adminSettings.llmApiType || detectProviderType(llmApiUrl)

  if (!llmApiUrl) {
    return res.status(400).json({
      success: false,
      error: 'Admin LLM API URL must be configured first',
    })
  }

  try {
    const { ids } = await listModels(normalizeSpecFor(llmApiUrl, llmApiKey, llmApiType, 'scan'), { timeoutMs: 60000 })
    res.json({ success: true, models: ids })
  } catch (error) {
    const status = error.code === 'auth' ? 401 : (error.status || 500)
    logger.error({ error: error.message, code: error.code }, '[LLM] Admin model scan failed')
    res.status(status).json({
      success: false,
      error: 'Model scan failed',
      status,
      details: error.message,
    })
  }
}


// overleaf-lab (usage meter): whole-site token accounting for the admin page.
async function usageSummary(req, res) {
  const days = parseInt(req.query.days, 10)
  const summary = await getUsageSummary({ userId: null, days: Number.isFinite(days) ? days : 30 })
  if (summary) {
    res.json({ ok: true, ...summary })
  }
  else {
    // the meter is non-fatal for the whole module — a missing store is a muted
    // "unavailable" on the UI, never a 500.
    res.json({ ok: false, error: 'unavailable' })
  }
}
export default {
  adminSettingsPage: expressify(adminSettingsPage),
  getAdminSettings: expressify(getAdminSettings),
  saveAdminSettings: expressify(saveAdminSettings),
  checkAdminLLMConnection: expressify(checkAdminLLMConnection),
  scanAdminModels: expressify(scanAdminModels),  usageSummary: expressify(usageSummary),
  getMcpUserMode: expressify(getMcpUserMode), // overleaf-lab (2026-11-05): per-user MCP mode (admin)
  saveMcpUserMode: expressify(saveMcpUserMode), // overleaf-lab (2026-11-05): per-user MCP mode (admin)
  getMcpTools: expressify(getMcpTools), // overleaf-lab (2026-11-05): MCP service listing (admin)

}
