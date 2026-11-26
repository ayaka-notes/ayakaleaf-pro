import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { Script } from 'node:vm'

const read = file => readFileSync(file, 'utf8')
function replaceOnce(text, before, after) {
  if (text.split(before).length !== 2) throw new Error(`Unexpected 6.3.4 source: ${before}`)
  return text.replace(before, () => after)
}
const server = 'modules/workbench/app/src/'
function edit(file, before, after) {
  writeFileSync(file, replaceOnce(read(file), before, after))
}
edit('modules/workbench/index.mjs', 'export default {', "import { restoreConnection } from './app/src/LocalConnection.mjs'\nrestoreConnection()\nexport default {")
edit(server + 'WorkbenchAiClient.mjs', 'let _provider = null', 'export { _getProxyFetch as getGatewayFetch }\nexport function resetGateway(){_provider=null;_proxyFetch=null}\nlet _provider = null')
edit(server + 'WorkbenchRouter.mjs', 'export default {', `import { listModels } from './LocalModelCatalog.mjs'
import { admin, readConnection, saveConnection } from './LocalConnection.mjs'
export default {`)
edit(server + 'WorkbenchRouter.mjs', "    webRouter.post(", `    webRouter.get('/workbench/connection', AuthenticationController.requireLogin(), expressify(admin), readConnection)
    webRouter.post('/workbench/connection', AuthenticationController.requireLogin(), expressify(admin), expressify(saveConnection))
    webRouter.get('/workbench/models', AuthenticationController.requireLogin(), PermissionsMiddleware.requireAiAccess, expressify(listModels))
    webRouter.post(`)
edit(server + 'WorkbenchController.mjs', 'async function chat(req, res) {', `import { catalog } from './LocalModelCatalog.mjs'
import { hasDefaultModel, defaultEffort } from './LocalConnection.mjs'
async function chat(req, res) {`)
edit(server + 'WorkbenchController.mjs', '  const toolCallLimit =', `  let chosenModel
  if (req.body?.modelSelection) {
    chosenModel = (await catalog()).find(entry => entry.key === req.body.modelSelection)
    if (!chosenModel) return res.status(400).json({ error: 'ai_model_unavailable' })
  } else if (!hasDefaultModel()) return res.status(400).json({ error: 'default_model_not_configured' })
  const effort = req.body?.reasoningEffort ?? chosenModel?.defaultLevel
  if (effort !== undefined && !chosenModel?.levels.includes(effort)) {
    return res.status(400).json({ error: 'unsupported_reasoning_effort' })
  }
  const toolCallLimit =`)
edit(server + 'WorkbenchController.mjs', 'getProvider()(resolvedModel)', 'chosenModel ? chosenModel.provider(chosenModel.id) : getProvider()(resolvedModel)')
edit(server + 'WorkbenchController.mjs', '    const result = streamText({', `    const languageModel = chosenModel ? chosenModel.provider(chosenModel.id) : getProvider()(resolvedModel)
    const result = streamText({
      providerOptions: appliedEffort ? { [languageModel.provider.split('.')[0]]: { reasoningEffort: appliedEffort } } : undefined,`)
edit(server + 'WorkbenchController.mjs', '    const result = streamText({', '    const appliedEffort = chosenModel ? effort : defaultEffort(resolvedModel)\n    const result = streamText({')
edit(server + 'WorkbenchController.mjs', 'model: chosenModel ? chosenModel.provider(chosenModel.id) : getProvider()(resolvedModel)', 'model: languageModel')

const original = 'ide-48473ebb1ad7e3b5dc2b.js'
let bundle = read('public/js/pages/' + original)
const location = bundle.indexOf('id:"assistant-attach"')
if (location < 0) throw new Error('Missing attachment button')
const insertion = bundle.indexOf('(0,I.jsx)("span",{className:"flex-grow-1"})', location)
if (insertion < location || insertion - location > 500) throw new Error('Unknown composer layout')
bundle = bundle.slice(0, insertion) + '(0,I.jsx)(WorkbenchModelPicker,{disabled:n}),' + bundle.slice(insertion)
const componentStart = bundle.lastIndexOf('const ', bundle.indexOf('new Mt.rL({api:"/workbench/chat"'))
// Both components must share the editor module's React and JSX runtime bindings.
const anchor = 'var Sn=n(86574),En=n.n(Sn);'
if (componentStart < insertion) throw new Error('Unexpected module layout')
bundle = replaceOnce(bundle, anchor, read('/tmp/aya-picker/picker.js') + '\n' + anchor)
const settingsAnchor = 'settingsTabs:r}=e;return(0,I.jsx)(zn.A,{transition:!1,onSelect:n,activeKey:t??void 0,id:"ide-settings-tabs"'
const assistantEntry = '{key:"workbench-api",title:"AI assistant",icon:"auto_awesome",sections:[{key:"connection",settings:[{key:"local-api",component:(0,I.jsx)(WorkbenchApiSettings,{})}]}]}'
bundle = replaceOnce(bundle, settingsAnchor, settingsAnchor.replace(';return', `;if((0,ut.A)("ol-ExposedSettings")?.aiAvailable){const accountIndex=r.findIndex(entry=>entry.key==="account_settings");r=r.slice();r.splice(accountIndex<0?r.length:accountIndex,0,${assistantEntry})}return`))
const settingsButtonIcon = 'as:"button",children:[(0,I.jsx)(Pe.A,{className:"ide-settings-tab-link-icon",type:t.icon,unfilled:!0})'
bundle = replaceOnce(bundle, settingsButtonIcon, settingsButtonIcon.replace('unfilled:!0', 'unfilled:t.key!=="workbench-api"'))
bundle = replaceOnce(bundle, 'messageId:s,messages:n.slice(o)', 'messageId:s,modelSelection:workbenchSelection||undefined,reasoningEffort:workbenchEfforts.get(workbenchSelection)||undefined,messages:n.slice(o)')
new Script(bundle)
const name = `ide-${createHash('sha256').update(bundle).digest('hex').slice(0, 20)}.js`
writeFileSync('public/js/pages/' + name, bundle)
const manifest = 'public/manifest.json'
if (!read(manifest).includes(original)) throw new Error('Missing editor manifest entry')
writeFileSync(manifest, read(manifest).replaceAll(original, name))
