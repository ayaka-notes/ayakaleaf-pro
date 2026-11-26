const pickerStorageKey = 'ayakaleaf.workbench.model'
let workbenchSelection = ''
try { workbenchSelection = localStorage.getItem(pickerStorageKey) || '' } catch {}
const effortStorageKey = pickerStorageKey + '.efforts'
let workbenchEfforts = new Map()
try { workbenchEfforts = new Map(JSON.parse(localStorage.getItem(effortStorageKey) || '[]')) } catch {}
const effortHelp = 'Controls how much time and quota the model spends reasoning before it responds. Higher effort can improve accuracy on difficult tasks, but may take longer and use more quota.'
const levelName = level => level ? level[0].toUpperCase() + level.slice(1) : ''
const effectiveLevel = model => levelName(workbenchEfforts.get(model.key) || model.defaultLevel)
const preferredEndpoint = 'http://127.0.0.1:3425/v1/models'
const sourceStorageKey = 'ayakaleaf.workbench.source'
function preferredSource(directory) {
  let saved
  try { saved = localStorage.getItem(sourceStorageKey) } catch {}
  return directory.sources.find(source => source.key === saved) ||
    directory.sources.find(source => source.endpoint === preferredEndpoint) || directory.sources[0]
}
async function readModelDirectory(signal, refresh = false) {
  const response = await fetch(refresh ? '/workbench/models?refresh=1' : '/workbench/models', { signal, cache: 'no-store' })
  if (!response.ok) throw new Error('Model directory unavailable')
  return response.json()
}
function WorkbenchConnectionTest() {
  const [directory, setDirectory] = C.useState(null)
  const [sourceKey, setSourceKey] = C.useState('')
  const [status, setStatus] = C.useState('Loading endpoints…')
  const [busy, setBusy] = C.useState(false)
  C.useEffect(() => {
    const abort = new AbortController()
    readModelDirectory(abort.signal).then(data => {
      if (abort.signal.aborted) return
      setDirectory(data)
      setSourceKey(preferredSource(data).key)
      setStatus('')
    }).catch(() => { if (!abort.signal.aborted) setStatus('Could not load endpoints. Reopen Settings to retry.') })
    return () => abort.abort()
  }, [])
  async function apply() {
    setBusy(true)
    try {
      const data = await readModelDirectory(undefined, true)
      const models = data.models.filter(model => model.key.startsWith(sourceKey + ':'))
      if (!models.length) { setStatus('No models available. Check that the local API is running.'); return }
      localStorage.setItem(sourceStorageKey, sourceKey)
      if (!models.some(model => model.key === workbenchSelection)) {
        workbenchSelection = sourceKey === 'gateway' ? '' : models[0].key
        localStorage.setItem(pickerStorageKey, workbenchSelection)
      }
      window.dispatchEvent(new CustomEvent('workbench-api-changed', { detail: data }))
      setStatus(`Connected · ${models.length} models available`)
    } catch { setStatus('Could not apply this endpoint.') }
    finally { setBusy(false) }
  }
  return I.jsxs('div', { className: 'd-flex flex-column gap-2', children: [
    I.jsx('label', { htmlFor: 'workbench-endpoint', children: 'Model catalog endpoint' }),
    I.jsx('select', { id: 'workbench-endpoint', className: 'form-select', disabled: !directory || busy, value: sourceKey,
      onChange: event => { setSourceKey(event.target.value); setStatus('') },
      children: directory?.sources.map(source => I.jsx('option', { value: source.key, children: source.endpoint || source.label }, source.key)) }),
    I.jsx('button', { type: 'button', className: 'btn btn-secondary align-self-start', disabled: !directory || busy, onClick: apply, children: busy ? 'Checking…' : 'Test and apply' }),
    I.jsx('div', { role: 'status', children: status }),
  ] })
}

function WorkbenchApiSettings() {
  const [form, setForm] = C.useState(null)
  const [status, message] = C.useState('Loading…')
  const [catalogStatus, catalogMessage] = C.useState('')
  const [busy, setBusy] = C.useState(false)
  C.useEffect(() => {
    const controller = new AbortController()
    fetch('/workbench/connection', {signal: controller.signal}).then(async response => {
      if (!response.ok) { message(response.status === 403 ? 'Only an instance administrator can edit this connection.' : 'Could not load the connection.'); return }
      setForm({...await response.json(), key: ''}); message('')
    }).catch(() => { if (!controller.signal.aborted) message('Could not load the connection. Please try again.') })
    return () => controller.abort()
  }, [])
  const update = (name, value) => {
    if (name === 'catalogUrl') catalogMessage(''); else message('')
    setForm(old => ({...old, [name]: value}))
  }
  async function save(event) {
    event.preventDefault()
    const testing = event.nativeEvent.submitter?.value === 'test'
    const urlField = event.currentTarget.elements.namedItem('aya-default-url')
    const modelField = event.currentTarget.elements.namedItem('aya-default-model')
    if (!form.url.trim()) { urlField.focus(); message('Please enter the default model API URL.'); return }
    if (urlField.validity.typeMismatch || !/^https?:\/\//i.test(form.url)) { urlField.focus(); message('Please enter a valid HTTP or HTTPS URL.'); return }
    if (!form.model.trim()) { modelField.focus(); message('Please enter the default model ID.'); return }
    setBusy(testing ? 'test' : 'save')
    message('')
    try {
      const {url, model, key, protocol, reasoningEffort} = form
      const response = await fetch('/workbench/connection', { method:'POST', headers:{'Content-Type':'application/json','X-Csrf-Token':(0,ut.A)('ol-csrfToken')}, body:JSON.stringify({url,model,key,protocol,reasoningEffort,section:testing ? 'test' : 'default'}) })
      if (!response.ok && (await response.clone().json().catch(() => ({}))).error === 'invalid_effort') { message('Enter a supported reasoning effort for this protocol, or leave it blank.'); return }
      if (testing) {
        if (response.status === 204) { message('✓ Model replied. Click “Save and apply” to use this model.'); return }
        const {error} = await response.json().catch(() => ({}))
        message(error === 'auth_required' ? 'Authentication failed. Check the key and model access.' : error === 'no_reply' ? 'The model returned no text within the test budget.' : 'Test failed. Check the API URL, key, model ID and protocol.')
        return
      }
      if (!response.ok) { message('Could not save. Check the URL, model ID and key for this endpoint.'); return }
      const saved = await response.json()
      setForm(old => ({...saved,key:'',catalogUrl:old.catalogUrl}))
      window.dispatchEvent(new CustomEvent('workbench-default-model-changed', {detail:{defaultModel:saved.model,defaultEffort:saved.reasoningEffort}}))
      message('Default model saved.')
    } catch { message(testing ? 'Could not complete the test. No settings were saved.' : 'Could not save the default model. Please try again.') } finally { setBusy(false) }
  }
  if (!form) return I.jsx('div',{role:'status',className:'ide-setting ide-setting-description',children:status})
  async function saveCatalog() {
    setBusy('catalog')
    catalogMessage('Checking the model catalog…')
    try {
      const response = await fetch('/workbench/connection', {method:'POST',headers:{'Content-Type':'application/json','X-Csrf-Token':(0,ut.A)('ol-csrfToken')},body:JSON.stringify({section:'catalog',catalogUrl:form.catalogUrl})})
      if (!response.ok) {
        const {error} = await response.json().catch(() => ({}))
        const reasons = {invalid_url:'Enter a local HTTP or HTTPS catalog URL.', auth_required:'Authentication required. Check access in your local gateway.', empty_catalog:'Connected, but the model catalog is empty.', invalid_catalog:'The endpoint did not return a valid model catalog.', connection_failed:'Could not connect to the model catalog.', save_failed:'The catalog was verified but could not be saved.'}
        catalogMessage((reasons[error] || 'Could not apply the model catalog.') + ' The saved URL is unchanged.'); return
      }
      const {catalogUrl,directory} = await response.json()
      update('catalogUrl',catalogUrl)
      window.dispatchEvent(new CustomEvent('workbench-api-changed',{detail:directory}))
      catalogMessage(`Local catalog saved. ${directory.models.length} models available.`)
    } catch { catalogMessage('Could not confirm the catalog update. Reopen Settings to check the saved URL.') } finally { setBusy(false) }
  }
  const controlStyle = { fontSize: 'var(--font-size-02)', width: '29ch', maxWidth: '100%', minWidth: 0, boxSizing: 'border-box' }
  function row(label, name, children, description) {
    return I.jsx(Pd, {label, controlId:'aya-default-' + name, description, children}, name)
  }
  function field(label, name, type = 'text', extra = {}) {
    return row(label, name, I.jsx('input',{id:'aya-default-' + name,className:'form-control form-control-sm',style:controlStyle,type,value:form[name],disabled:busy,onChange:event=>update(name,event.target.value),...extra}), name === 'key' ? 'Leave blank to keep the key for this endpoint.' : undefined)
  }
  const presets = [preferredEndpoint,'http://127.0.0.1:11434/v1/models','http://127.0.0.1:1234/v1/models']
  return I.jsxs('form',{lang:'en',noValidate:true,onSubmit:save,className:'d-flex flex-column',style:{gap:'var(--spacing-06)'},children:[
    field('Default model API URL','url','url',{required:true,placeholder:'https://api.example.com/v1'}),
    field('API key','key','password',{autoComplete:'new-password'}),
    field('Default model ID','model','text',{required:true}),
    field('Reasoning effort','reasoningEffort','text',{placeholder:'Provider default',maxLength:32}),
    row('API protocol','protocol',I.jsx('select',{id:'aya-default-protocol',className:'form-select form-select-sm ide-dropdown-setting-wide',style:controlStyle,disabled:busy,value:form.protocol,onChange:event=>update('protocol',event.target.value),children:[I.jsx('option',{value:'chat',children:'Chat Completions'},'chat'),I.jsx('option',{value:'responses',children:'Responses API'},'responses')]})),
    row('Default model','save',I.jsxs('div',{className:'d-flex flex-wrap gap-2',children:[
      I.jsx('button',{id:'aya-default-save',type:'submit',disabled:!!busy,className:'btn btn-secondary btn-sm',children:busy==='save'?'Saving…':'Save and apply'}),
      I.jsx('button',{type:'submit',value:'test',disabled:!!busy,className:'btn btn-secondary btn-sm',children:busy==='test'?'Testing…':'Test'})
    ]}),'Test sends a short prompt without saving. API charges may apply.'),
    status && I.jsx('div',{className:'ide-setting ide-setting-description',role:'status',children:status}),
    I.jsx('div',{className:'ide-settings-section-title',children:'Local models'}),
    field('Model catalog URL','catalogUrl','text',{list:'aya-endpoints',onKeyDown:event=>{if(event.key==='Enter' && !event.nativeEvent.isComposing){event.preventDefault();if(!busy)saveCatalog()}}}),
    I.jsx('datalist',{id:'aya-endpoints',children:presets.map(value=>I.jsx('option',{value},value))}),
    row('Local model list','catalog-save',I.jsx('button',{id:'aya-default-catalog-save',type:'button',onClick:saveCatalog,disabled:!!busy,className:'btn btn-secondary btn-sm',children:busy==='catalog'?'Checking…':'Save and refresh'}),'Loads the other models shown in the chat picker.'),
    catalogStatus && I.jsx('div',{className:'ide-setting ide-setting-description',role:'status',children:catalogStatus})
  ]})
}

function WorkbenchModelPicker({ disabled }) {
  const [defaults, setDefaults] = C.useState(null)
  const [choice, setChoice] = C.useState(workbenchSelection)
  const [directory, setDirectory] = C.useState(null)
  const trigger = C.useRef(null)
  const menu = C.useRef(null)
  const menuId = C.useId()
  const submenu = C.useRef(null)
  const origin = C.useRef(null)
  const [candidate, setCandidate] = C.useState(null)
  const [help, setHelp] = C.useState(false)
  function showHelp(event) {
    const bounds = event.currentTarget.getBoundingClientRect()
    const width = Math.min(320, window.innerWidth - 16)
    const left = Math.max(8, Math.min(bounds.right - width, window.innerWidth - width - 8))
    setHelp({ width, left, ...(bounds.top >= 140
      ? { bottom: window.innerHeight - bounds.top + 6 }
      : { top: bounds.bottom + 6 }) })
  }
  C.useEffect(() => {
    const abort = new AbortController()
    function sync(data) {
      const source = preferredSource(data)
      const models = data.models.filter(model => model.key.startsWith(source.key + ':'))
      if (!models.some(model => model.key === workbenchSelection)) {
        workbenchSelection = source.key === 'gateway' ? '' : models[0]?.key || ''
      }
      setChoice(workbenchSelection)
      setDirectory({ source, models })
    }
    const changed = event => { sync(event.detail); setDefaults(event.detail) }
    const saved = event => setDefaults(event.detail)
    window.addEventListener('workbench-default-model-changed', saved)
    window.addEventListener('workbench-api-changed', changed)
    readModelDirectory(abort.signal).then(data => { if (!abort.signal.aborted) { sync(data); setDefaults(current => current || data) } }).catch(() => {})
    return () => { abort.abort(); window.removeEventListener('workbench-api-changed', changed); window.removeEventListener('workbench-default-model-changed', saved) }
  }, [])
  const defaultLabel = defaults?.defaultModel ? `Default model (${defaults.defaultModel})` : 'Default model'
  const options = [...(!directory || directory.source.key === 'gateway' ? [{ key: '', label: defaultLabel, defaultLevel:defaults?.defaultEffort }] : []), ...(directory?.models || [])]
  const selected = options.find(option => option.key === choice) || { key: choice, label: choice }
  const effortText = effectiveLevel(selected)
  const selectionText = [selected.label, effortText].filter(Boolean).join(' ')
  function openMenu() {
    const panel = menu.current
    if (panel.matches(':popover-open')) return panel.hidePopover()
    const bounds = trigger.current.getBoundingClientRect()
    const width = Math.min(270, window.innerWidth - 16)
    const above = bounds.top >= 196 || bounds.top > window.innerHeight - bounds.bottom
    Object.assign(panel.style, {
      width: `${width}px`,
      left: `${Math.max(8, Math.min(bounds.left, window.innerWidth - width - 8))}px`,
      top: above ? 'auto' : `${bounds.bottom + 4}px`,
      bottom: above ? `${window.innerHeight - bounds.top + 4}px` : 'auto',
      maxHeight: `${Math.min(192, Math.max(32, (above ? bounds.top : window.innerHeight - bounds.bottom) - 12))}px`,
    })
    panel.showPopover()
    const active = panel.querySelector('[aria-selected="true"]') || panel.firstElementChild
    active?.focus()
    active?.scrollIntoView({ block: 'nearest' })
  }
  function closeLevels() {
    submenu.current?.hidePopover()
    setHelp(false)
    setCandidate(null)
  }
  function openLevels(option, button, focus) {
    origin.current = button
    setCandidate(option)
    setHelp(false)
    const panel = submenu.current
    const bounds = menu.current.getBoundingClientRect()
    const width = Math.min(210, window.innerWidth - 16)
    const left = bounds.right + width <= window.innerWidth - 8 ? bounds.right :
      Math.max(8, bounds.left - width)
    Object.assign(panel.style, { width: width + 'px', left: left + 'px',
      top: Math.max(8, Math.min(button.getBoundingClientRect().top, window.innerHeight - Math.min(280, 68 + option.levels.length * 30) - 8)) + 'px' })
    if (!panel.matches(':popover-open')) panel.showPopover()
    if (focus) requestAnimationFrame(() => panel.querySelector('[aria-checked="true"]')?.focus())
  }
  function choose(key, level) {
    if (level) workbenchEfforts.set(key, level)
    else workbenchEfforts.delete(key)
    try { localStorage.setItem(effortStorageKey, JSON.stringify([...workbenchEfforts])) } catch {}
    closeLevels()
    workbenchSelection = key
    setChoice(key)
    try { localStorage.setItem(pickerStorageKey, key) } catch {}
    menu.current.hidePopover()
    trigger.current.focus()
  }
  return I.jsxs(I.Fragment, {
    children: [
      I.jsx('button', {
        ref: trigger, type: 'button', disabled, 'aria-label': `AI model: ${selectionText}`,
        'aria-haspopup': 'listbox', 'aria-controls': menuId, title: selectionText,
        onClick: openMenu,
        style: { display: 'inline-flex', alignItems: 'baseline', gap: 5, flex: '0 1 auto', minWidth: 0, marginInlineEnd: 12, whiteSpace: 'nowrap', border: 0, borderRadius: 4, padding: '3px 6px', color: 'inherit', background: 'transparent', font: 'inherit', fontSize: 'var(--font-size-02)' },
        children: [
          I.jsx('span', { style: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }, children: selected.label }, 'model'),
          effortText && I.jsx('span', { style: { flexShrink: 0, color: 'var(--content-secondary-themed, GrayText)' }, children: effortText }, 'effort'),
        ],
      }),
      I.jsx('div', {
        ref: menu, id: menuId, popover: 'auto', role: 'listbox', 'aria-label': 'AI model',
        onToggle: event => {
          if (event.target !== event.currentTarget) return
          const opened = event.currentTarget.matches(':popover-open')
          trigger.current?.setAttribute('aria-expanded', String(opened))
          if (!opened) closeLevels()
        },
        onKeyDown(event) {
          const item = event.target
          if (submenu.current.contains(item)) return
          const next = { ArrowDown: item.nextElementSibling?.matches('button') && item.nextElementSibling, ArrowUp: item.previousElementSibling, Home: menu.current.firstElementChild, End: submenu.current.previousElementSibling }
          if (Object.hasOwn(next, event.key)) {
            event.preventDefault()
            if (next[event.key]) next[event.key].focus()
          }
          if (event.key === 'Tab') menu.current.hidePopover()
        },
        style: { position: 'fixed', inset: 'auto', margin: 0, boxSizing: 'border-box', overflowY: 'auto', overscrollBehavior: 'contain', padding: 3, border: '1px solid var(--border-divider, #aaa)', borderRadius: 6, background: 'var(--bg-light-primary, Canvas)', color: 'inherit', boxShadow: '0 3px 12px #0002' },
        children: [...options.map(option => I.jsx('button', {
          type: 'button', role: 'option', tabIndex: -1, 'aria-selected': option.key === choice,
          title: option.label, 'aria-haspopup': option.levels?.length ? 'menu' : undefined,
          onMouseEnter: event => option.levels?.length ? openLevels(option, event.currentTarget, false) : closeLevels(),
          onKeyDown(event) {
            if (event.key === 'ArrowRight' && option.levels?.length) {
              event.preventDefault()
              openLevels(option, event.currentTarget, true)
            }
          },
          onClick: () => choose(option.key, workbenchEfforts.get(option.key)),
          style: { display: 'block', width: '100%', height: 30, textAlign: 'start', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', border: 0, borderRadius: 3, padding: '2px 8px', color: 'inherit', background: option.key === choice ? 'var(--bg-light-secondary, #8882)' : 'transparent', font: 'inherit', fontSize: 'var(--font-size-02)' },
          children: option.levels?.length ? [
            I.jsx('span', { style: { float: 'right', marginLeft: 4 }, onClick: event => { event.stopPropagation(); openLevels(option, event.currentTarget.parentElement, true) }, children: effectiveLevel(option) + ' ›' }, 'level'),
            option.label,
          ] : !option.key && option.defaultLevel ? [I.jsx('span',{style:{float:'right',marginLeft:4,color:'var(--content-secondary-themed, GrayText)'},children:levelName(option.defaultLevel)},'effort'), option.label] : option.label,
        }, option.key)), I.jsxs('div', {
          ref: submenu, popover: 'auto', role: 'menu', 'aria-label': 'Thinking effort',
          style: { position: 'fixed', inset: 'auto', margin: 0, padding: 5, boxSizing: 'border-box', maxHeight: 'min(280px, 90vh)', overflowY: 'auto', color: 'inherit', background: 'var(--bg-light-primary, Canvas)', border: '1px solid var(--border-divider, #aaa)', borderRadius: 6, boxShadow: '0 3px 12px #0002', fontSize: 'var(--font-size-02)' },
          onKeyDown(event) {
            if (event.key === 'ArrowLeft' || event.key === 'Escape') {
              event.preventDefault()
              closeLevels()
              origin.current?.focus()
            }
            const buttons = [...submenu.current.querySelectorAll('[role="menuitemradio"]')]
            const index = buttons.indexOf(event.target)
            if (['ArrowDown', 'ArrowUp', 'End', 'Home'].includes(event.key) && buttons.length) {
              event.preventDefault()
              const offset = event.key === 'ArrowDown' ? 1 : -1
              const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + offset + buttons.length) % buttons.length
              buttons[next].focus()
            }
          },
          children: [
            I.jsxs('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '2px 6px' }, children: [
              'Thinking effort', I.jsx('button', { type: 'button', 'aria-label': 'About thinking effort', 'aria-describedby': help ? menuId + '-help' : undefined,
                onMouseEnter: showHelp, onMouseLeave: () => setHelp(false), onFocus: showHelp, onBlur: () => setHelp(false),
                onClick: showHelp, style: { background: 'transparent', color: 'inherit', border: 0, cursor: 'help' }, children: 'ⓘ' }),
            ] }),
            help && I.jsx('div', { role: 'tooltip', id: menuId + '-help', style: {
              position: 'fixed', ...help, pointerEvents: 'none', zIndex: 1, boxSizing: 'border-box',
              padding: '6px 10px', background: 'var(--bg-light-primary, Canvas)', border: '1px solid var(--border-divider, #aaa)',
              borderRadius: 6, boxShadow: '0 3px 12px #0002',
            }, children: effortHelp }),
            ...(candidate ? ['', ...candidate.levels].map(level => I.jsx('button', {
              type: 'button', role: 'menuitemradio', 'aria-checked': (workbenchEfforts.get(candidate.key) || '') === level,
              style: { display: 'block', width: '100%', height: 30, padding: '2px 8px', color: 'inherit', textAlign: 'start', border: 0, background: 'transparent', font: 'inherit' },
              onClick: () => choose(candidate.key, level), children: (levelName(level) || `Default (${levelName(candidate.defaultLevel)})`) + ((workbenchEfforts.get(candidate.key) || '') === level ? ' ✓' : ''),
            }, level)) : []),
          ],
        }, 'effort-menu')],
      }),
    ],
  })
}
