import Settings from '@overleaf/settings'
import { hasDefaultModel, defaultEffort } from './LocalConnection.mjs'
import fs from 'node:fs'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { getProvider, getGatewayFetch } from './WorkbenchAiClient.mjs'

let snapshot
let pending
let generation = 0
export function invalidateCatalog() { generation++; snapshot = undefined; pending = undefined }

let catalogGateway
const catalogFile = '/var/lib/overleaf/data/ai-local-model-catalog-url'
const defaultUrl = 'http://127.0.0.1:3425/v1/models'
let initialGateway
export function localCatalogUrl() { return catalogGateway.url.replace('host.docker.internal', '127.0.0.1') + '/models' }
function candidateGateway(input) {
  const url = new URL(input)
  if (!['127.0.0.1','localhost','[::1]','host.docker.internal'].includes(url.hostname) || !['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw Error('Invalid local URL')
  url.hostname = 'host.docker.internal'
  const base = url.href.replace(/\/+$/, '').replace(/\/models$/, '')
  return initialGateway.url?.replace(/\/+$/, '') === base ? {...initialGateway, url:base} : { key:'gateway', label:'Local gateway', url:base, apiMode:'chat' }
}
export async function verifyAndSaveCatalog(input) {
  let candidate
  try { candidate = candidateGateway(input) } catch { throw Error('invalid_url') }
  const entries = await discover(candidate)
  if (!entries.length) throw Error('empty_catalog')
  try {
    fs.writeFileSync(catalogFile + '.tmp', candidate.url + '/models', {mode:0o600})
    fs.renameSync(catalogFile + '.tmp', catalogFile)
  } catch { throw Error('save_failed') }
  catalogGateway = candidate
  invalidateCatalog()
  snapshot = { entries, expires:Date.now() + 30000 }
  return directory(entries)
}
export function captureCatalogGateway() {
  const gateway = Settings.workbenchAi
  const provider = getProvider()
  initialGateway = { key: 'gateway', label: 'Configured gateway', url: gateway.baseURL, token: gateway.apiKey, provider: () => provider, request: getGatewayFetch(), apiMode: gateway.apiMode }
  let endpoint = defaultUrl
  try { endpoint = fs.readFileSync(catalogFile, 'utf8') } catch (error) { if (error.code !== 'ENOENT') throw error }
  catalogGateway = candidateGateway(endpoint)
  invalidateCatalog()
}
function sources() {
  return [catalogGateway]
}

async function discover(source) {
  const baseURL = source.url.replace(/\/+$/, '')
  const response = await (source.request || fetch)(`${baseURL}/models`, {
    headers: source.token ? { Authorization: `Bearer ${source.token}` } : {},
    redirect: 'error',
    signal: AbortSignal.timeout(3500),
  })
  if (response.status === 401 || response.status === 403) throw Error('auth_required')
  if (!response.ok) throw Error('connection_failed')
  const data = (await response.json().catch(() => null))?.data
  if (!Array.isArray(data) || data.some(entry => typeof entry?.id !== 'string' || !entry.id.trim())) throw Error('invalid_catalog')
  const models = new Map(data.filter(entry => typeof entry?.id === 'string' && entry.id.length)
    .map(entry => [entry.id, entry]))
  const provider = source.provider?.() || createOpenAICompatible({ name: source.key, baseURL })
  return Array.from(models, ([id, entry]) => {
    const label = [entry.magpie_label, entry.label, entry.display_name, entry.displayName, entry.name]
      .find(value => typeof value === 'string' && value.trim()) || id
    const advertised = [entry.reasoning_levels, entry.supported_reasoning_levels]
      .filter(Array.isArray).flat().map(level => typeof level === 'string' ? level : level?.effort)
    const responses = source.apiMode === 'responses'
    const levels = [...new Set(advertised.filter(level => typeof level === 'string' && level.trim() &&
      (!responses || ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'].includes(level))))]
    const defaultLevel = [entry.default_reasoning_effort, entry.default_reasoning_level,
      entry.supported_reasoning_levels?.find?.(level => level?.default === true)?.effort,
      'medium', levels[0]].find(level => levels.includes(level))
    return { key: `${source.key}:${id}`, source: source.label, id, label, provider, levels, defaultLevel }
  })
}

export async function catalog(refresh = false) {
  if (!refresh && snapshot && Date.now() < snapshot.expires) return snapshot.entries
  const version = generation
  pending ??= Promise.allSettled(sources().map(discover)).then(results => {
    const entries = results.flatMap(result => result.status === 'fulfilled' ? result.value : [])
    if (version === generation) snapshot = { entries, expires: Date.now() + (entries.length ? 30000 : 5000) }
    return entries
  }).finally(() => { if (version === generation) pending = undefined })
  return pending
}

export async function listModels(req, res) {
  const entries = await catalog(req.query.refresh === '1')
  res.set('Cache-Control', 'private, no-store').json(directory(entries))
}
function directory(entries) {
  return {
    sources: sources().map(source => {
      const url = new URL(source.url)
      const local = ['host.docker.internal', 'localhost', '127.0.0.1'].includes(url.hostname)
      if (local) url.hostname = '127.0.0.1'
      return { key: source.key, label: source.label, endpoint: local ? `${url.origin}${url.pathname.replace(/\/+$/, '')}/models` : null }
    }),
    defaultModel: hasDefaultModel() ? Settings.workbenchAi.model : null,
    defaultEffort: hasDefaultModel() ? defaultEffort(Settings.workbenchAi.model) : '',
    models: entries.map(({ key, source, id, label, levels, defaultLevel }) => ({ key, source, id, label, levels, defaultLevel })),
  }
}
