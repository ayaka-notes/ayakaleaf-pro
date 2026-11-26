import fs from 'node:fs'
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'
import Settings from '@overleaf/settings'
import SessionManager from '../../../../app/src/Features/Authentication/SessionManager.mjs'
import UserGetter from '../../../../app/src/Features/User/UserGetter.mjs'
import { generateText } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import { getGatewayFetch, resetGateway } from './WorkbenchAiClient.mjs'
import { captureCatalogGateway, localCatalogUrl, verifyAndSaveCatalog } from './LocalModelCatalog.mjs'

const loopback = host => ['localhost', '127.0.0.1', '[::1]', 'host.docker.internal'].includes(host)
const file = '/var/lib/overleaf/data/ai-assistant-connection.enc'
function encryptionKey() {
  const secret = process.env.OVERLEAF_SESSION_SECRET
  if (!secret) throw Error('Instance secret required')
  return hkdfSync('sha256', secret, '', 'ayakaleaf-ai-connection-v1', 32)
}
let explicitlyConfigured = false
export function defaultEffort(model) { return model === Settings.workbenchAi.model ? Settings.workbenchAi.reasoningEffort || '' : '' }
export function hasDefaultModel() { return explicitlyConfigured || Boolean(Settings.workbenchAi.baseURL && !loopback(new URL(Settings.workbenchAi.baseURL).hostname)) }
function activate({ mode, ...connection }) {
  explicitlyConfigured = true
  Object.assign(Settings.workbenchAi, connection)
  resetGateway()
}
export function restoreConnection() {
  captureCatalogGateway()
  let data
  try { data = fs.readFileSync(file) } catch (error) { if (error.code === 'ENOENT') return; throw error }
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), data.subarray(0, 12))
  decipher.setAuthTag(data.subarray(12, 28))
  activate(JSON.parse(Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString()))
}
function persist(connection) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv)
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(connection)), cipher.final()])
  const temp = file + '.' + randomBytes(8).toString('hex')
  try {
    fs.writeFileSync(temp, Buffer.concat([iv, cipher.getAuthTag(), encrypted]), {mode:0o600, flag:'wx'})
    fs.renameSync(temp, file)
  } finally { fs.rmSync(temp, {force:true}) }
  activate(connection)
}
function current() {
  if (!hasDefaultModel()) return {url:'', model:'', reasoningEffort:'', protocol:'chat', catalogUrl:localCatalogUrl()}
  const ai = Settings.workbenchAi
  const url = new URL(ai.baseURL)
  if (loopback(url.hostname)) url.hostname = '127.0.0.1'
  return { url: url.href.replace(/\/$/, ''), model: ai.model, reasoningEffort:defaultEffort(ai.model), protocol: ai.apiMode, catalogUrl:localCatalogUrl() }
}
export async function admin(req, res, next) {
  const user = await UserGetter.promises.getUser(SessionManager.getLoggedInUserId(req.session), { isAdmin: 1 })
  if (!user?.isAdmin) return res.sendStatus(403)
  next()
}
export function readConnection(req, res) { res.set('Cache-Control', 'no-store').json(current()) }
let saving = false
export async function saveConnection(req, res) {
  if (saving) return res.sendStatus(409)
  saving = true
  try {
    if (req.body?.section === 'catalog') {
      try {
        const directory = await verifyAndSaveCatalog(req.body.catalogUrl)
        return res.set('Cache-Control','no-store').json({ catalogUrl:localCatalogUrl(), directory })
      } catch (error) {
        const code = ['invalid_url','empty_catalog','auth_required','invalid_catalog','save_failed'].includes(error.message) ? error.message : 'connection_failed'
        return res.status(400).json({error:code})
      }
    }
    const { protocol, model, key = '' } = req.body || {}
    const effort = (req.body.reasoningEffort ?? '').trim().toLowerCase()
    if (effort && (!/^[a-z0-9][a-z0-9_-]{0,31}$/.test(effort) || (protocol === 'responses' && !['none','minimal','low','medium','high','xhigh'].includes(effort)))) return res.status(400).json({error:'invalid_effort'})
    if (!['chat','responses'].includes(protocol)) throw Error()
    const url = new URL(req.body.url)
    if (url.username || url.password || url.search || url.hash || !['http:', 'https:'].includes(url.protocol)) throw Error()
    if (!loopback(url.hostname) && url.protocol !== 'https:') throw Error()
    if (loopback(url.hostname)) url.hostname = 'host.docker.internal'
    const base = url.href.replace(/\/+$/, '').replace(/\/models$/, '')
    const ai = Settings.workbenchAi
    const same = hasDefaultModel() && base === ai.baseURL?.replace(/\/+$/, '')
    const token = key || (same ? ai.apiKey : '') || (loopback(url.hostname) ? 'local' : '')
    if (typeof model !== 'string' || !model.trim() || model.length > 512 || typeof token !== 'string' || !token || token.length > 8192 || /[\r\n]/.test(token)) throw Error()
    if (req.body.section === 'test') {
      const request = getGatewayFetch() || fetch
      const config = { baseURL:base, apiKey:token, fetch:(url, init) => request(url,{...init,redirect:'error'}) }
      const provider = protocol === 'responses' ? createOpenAI(config).responses : createOpenAICompatible({...config,name:'workbench'})
      try {
        const result = await generateText({ model:provider(model.trim()), prompt:'Reply with OK.', maxOutputTokens:64, maxRetries:0,
          abortSignal:AbortSignal.timeout(30000), providerOptions:protocol === 'responses' ? {openai:{store:false,...(effort && {reasoningEffort:effort})}} : effort ? {workbench:{reasoningEffort:effort}} : undefined })
        if (!result.text?.trim()) return res.status(422).json({error:'no_reply'})
        return res.sendStatus(204)
      } catch (error) {
        return res.status(422).json({error:[401,403].includes(error.statusCode) ? 'auth_required' : 'model_test_failed'})
      }
    }
    persist({ enabled:true, baseURL:base, apiMode:protocol, model:model.trim(), reasoningEffort:effort, apiKey:token, imageModel:same ? ai.imageModel : undefined, pdfModel:same ? ai.pdfModel : undefined })
    return readConnection(req, res)
  } catch { return res.status(400).json({error:'Check the URL, model ID, and API key. Changing a manual endpoint requires a new key.'}) }
  finally { saving = false }
}
