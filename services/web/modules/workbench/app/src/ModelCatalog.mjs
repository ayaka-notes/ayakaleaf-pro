import Settings from '@overleaf/settings'
import { _getProxyFetch, isConfigured } from './WorkbenchAiClient.mjs'

let cached
let pending

async function discover() {
  const { baseURL, apiKey, apiMode } = Settings.workbenchAi
  const request = _getProxyFetch() || fetch
  const response = await request(`${baseURL.replace(/\/+$/, '')}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(4000),
    redirect: 'error',
  })
  if (!response.ok) return []
  const { data } = await response.json()
  if (!Array.isArray(data)) return []
  return data.filter(entry => typeof entry?.id === 'string' && entry.id).map(entry => {
    const label = [entry.magpie_label, entry.label, entry.display_name, entry.name]
      .find(value => typeof value === 'string' && value.trim()) || entry.id
    const levels = [...new Set([entry.reasoning_levels, entry.supported_reasoning_levels]
      .filter(Array.isArray).flat().map(value => typeof value === 'string' ? value : value?.effort)
      .filter(value => typeof value === 'string' && value && (apiMode !== 'responses' ||
        ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'].includes(value))))]
    const defaultLevel = [entry.default_reasoning_effort, entry.default_reasoning_level, 'medium', levels[0]]
      .find(value => levels.includes(value))
    return { id: entry.id, label, levels, defaultLevel }
  })
}

export async function getModelCatalog() {
  if (!isConfigured() || process.env.AI_MODEL_PICKER_ENABLED !== 'true') return []
  if (cached && cached.expires > Date.now()) return cached.models
  pending ??= discover().catch(() => []).then(models => {
    cached = { models, expires: Date.now() + (models.length ? 30000 : 5000) }
    return models
  }).finally(() => { pending = undefined })
  return pending
}
