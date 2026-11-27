/* eslint-disable no-console -- CLI E2E runner/driver: stdout is the test report */
// Minimal CDP driver for local Overleaf E2E (Node 22, no deps).
import { spawn, execSync } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
import net from 'node:net'

const PORT = process.env.CDP_PORT || '9333'
const PROFILE = process.env.CDP_PROFILE || '/tmp/oly-cdp-profile'

// Kill any stale instance of our own CDP browser (exact flag match), then
// wait until the debug port is actually free — otherwise a dying previous
// instance serves the HTTP endpoint and the target ids we get back are
// stale ("No target with given id found").
async function preflight () {
  try {
    execSync(`pkill -f -- "--remote-debugging-port=${PORT}" 2>/dev/null || true`, { stdio: 'ignore' })
  } catch {}
  await sleep(400) // let a dying instance release the socket
  const port = Number.parseInt(PORT, 10)
  const deadline = Date.now() + 10000
  let free = false
  while (Date.now() < deadline) {
    free = await new Promise((res) => {
      const srv = net.createServer()
      srv.once('error', () => res(false))
      srv.once('listening', () => { srv.close(() => res(true)) })
      srv.listen(port, '127.0.0.1')
    })
    if (free) return true
    await sleep(400)
  }
  return free
}

let chrome = null

async function httpJson(path, method = 'GET') {
  const r = await fetch(`http://127.0.0.1:${PORT}${path}`, { method })
  return r.json()
}

async function waitForCDP() {
  for (let i = 0; i < 60; i++) {
    try { return await httpJson('/json/version') } catch (e) { await sleep(500) }
  }
  throw new Error('CDP endpoint never came up')
}

class Browser extends EventTarget {
  constructor(version) {
    super()
    this.version = version
    this.ws = new WebSocket(version.webSocketDebuggerUrl)
    this.id = 0
    this.pending = new Map()
    this.lastMethods = new Map()
    this.sessions = new Map() // targetId -> sessionId
    this.targets = new Map()
    this.ws.onmessage = (ev) => this._onMessage(JSON.parse(ev.data))
    this._ready = new Promise((res, rej) => {
      this.ws.onopen = res
      this.ws.onerror = () => rej(new Error('browser ws error'))
    })
    this._onCDPEvent = (e) => {
      this.dispatchEvent(new CustomEvent('cdp', { detail: e }))
    }
    this.listen('Target.targetCreated', (p) => this.targets.set(p.targetInfo.targetId, p.targetInfo))
    this.listen('Target.targetDestroyed', (p) => this.targets.delete(p.targetInfo.targetId))
    this.listen('Runtime.consoleAPICalled', (p) => {
      if (globalThis.E2E_VERBOSE_CONSOLE) {
        const text = (p.args || []).map(a => a.value ?? a.description ?? '').join(' ')
        console.log(`  [page console] ${p.type}: ${text.slice(0, 300)}`)
      }
    })
  }
  listen(method, cb) {
    const handler = (e) => { if (e.detail.method === method) cb(e.detail.params ?? {}) }
    this.addEventListener('cdp', handler)
  }
  _onMessage(m) {
    const { id, result, error, method, params, sessionId } = m
    if (id !== undefined) {
      const p = this.pending.get(id)
      if (p) {
        this.pending.delete(id)
        const mname = this.lastMethods.get(id) || '?'
        this.lastMethods.delete(id)
        if (error) {
          p.rej(new Error(`${error.message} [method: ${mname}]`))
        } else {
          p.res(result)
        }
      }
      return
    }
    if (method) this._onCDPEvent({ method, params, sessionId })
  }
  async send(method, params = {}, sessionId) {
    await this._ready
    const id = ++this.id
    this.lastMethods.set(id, method)
    const payload = JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })
    this.ws.send(payload)
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej })
      setTimeout(() => {
        if (this.pending.delete(id)) rej(new Error(`CDP timeout: ${method}`))
      }, 30_000)
    })
  }
  async attach(targetId) {
    if (this.sessions.has(targetId)) return this.sessions.get(targetId)
    const { sessionId } = await this.send('Target.attachToTarget', { targetId, flatten: true })
    this.sessions.set(targetId, sessionId)
    return sessionId
  }
  async pageTargets() {
    const list = await httpJson('/json/list')
    return list.filter(t => t.type === 'page' && !String(t.url || '').startsWith('devtools://')).map(t => t.id)
  }
  async currentTargetId(prefer) {
    const ids = await this.pageTargets()
    if (ids.includes(prefer)) return prefer
    return ids[ids.length - 1] || null
  }
  async newTab(url) {
    const t = await httpJson(`/json/new?${encodeURIComponent(url)}`, 'PUT')
    this.targets.set(t.id, t)
    return t.id
  }
  async evalIn(targetId, expression, { awaitPromise = false } = {}) {
    const sessionId = await this.attach(targetId)
    const r = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise,
      returnByValue: true,
      userGesture: true,
    }, sessionId)
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text)
    }
    return r.result?.value
  }
  async url(targetId) {
    return this.evalIn(targetId, 'location.href')
  }
  async click(targetId, cssSelector) {
    return this.evalIn(targetId, `(() => {
      const el = document.querySelector(${JSON.stringify(cssSelector)})
      if (!el) return 'no-match'
      el.scrollIntoView({ block: 'center' })
      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
      return 'clicked'
    })()`)
  }
  async typeReal(targetId, cssSelector, text) {
    const sid = await this.attach(targetId)
    await this.send('Runtime.evaluate', {
      expression: `(() => { const el = document.querySelector(${JSON.stringify(cssSelector)}); if (!el) throw new Error('no el ' + ${JSON.stringify(cssSelector)}); el.focus(); return true })()`,
    }, sid)
    for (const ch of String(text)) {
      await this.send('Input.dispatchKeyEvent', {
        type: 'char', text: ch, unmodifiedText: ch, textToCommit: ch,
      }, sid)
    }
    return 'real-typed:' + String(text).length
  }

  /** Replace the full selection (after select-all) with `text` using the
   *  CDP `Input.insertText` — one shot, generates a proper beforeinput. */
  async insertText(targetId, text) {
    const sid = await this.attach(targetId)
    await this.send('Input.insertText', { text: String(text) }, sid)
    return 'inserted:' + String(text).length
  }

  /** Ctrl-A keyboard select-all on the focused element. */
  async selectAll(targetId) {
    const sid = await this.attach(targetId)
    await this.send('Input.dispatchKeyEvent', {
      type: 'keyDown', key: 'a', code: 'KeyA', text: 'a', modifiers: 2,
    }, sid)
    await this.send('Input.dispatchKeyEvent', {
      type: 'keyUp', key: 'a', code: 'KeyA', modifiers: 2,
    }, sid)
    return 'select-all'
  }

  async type(targetId, cssSelector, value) {
    return this.evalIn(targetId, `(() => {
      const el = document.querySelector(${JSON.stringify(cssSelector)})
      if (!el) return 'no-match'
      el.focus()
      const proto = el.tagName === 'TEXTAREA'
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype
      const desc = Object.getOwnPropertyDescriptor(proto, 'value')
      desc.set.call(el, ${JSON.stringify(value)})
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
      return 'typed'
    })()`)
  }
  async snapshotForms(targetId) {
    return this.evalIn(targetId, `(() => {
      const out = []
      for (const f of document.forms) {
        out.push({ action: f.action, inputs: [...f.querySelectorAll('input,select,button')].map(i => ({
          tag: i.tagName.toLowerCase(), type: i.type || null, name: i.name || null,
          id: i.id || null, placeholder: i.placeholder || null,
          text: (i.textContent || '').trim().slice(0, 40) || null,
          label: i.labels?.[0]?.textContent?.trim() || null,
        })) })
      }
      return out
    })()`)
  }
  async setFileInput(targetId, cssSelector, files) {
    const sessionId = await this.attach(targetId)
    const r = await this.send('DOM.getDocument', {}, sessionId)
    const found = await this.send('DOM.querySelector', { nodeId: r.root, selector: cssSelector }, sessionId)
    if (!found.nodeId) throw new Error(`no file input for ${cssSelector}`)
    await this.send('DOM.setFileInputFiles', { files, nodeId: found.nodeId }, sessionId)
  }
}

async function start() {
  if (!chrome) {
    await preflight()
    chrome = spawn('chromium-browser', [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      `--remote-debugging-port=${PORT}`,
      '--remote-debugging-address=127.0.0.1',
      `--user-data-dir=${PROFILE}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--window-size=1600,1000',
      '--autoplay-policy=no-user-gesture-required',
      'about:blank',
    ], { stdio: 'ignore' })
    if (process.env.CDP_DEBUG) {
      chrome.on('exit', (code, sig) => console.log(`[cdp] chrome exited code=${code} sig=${sig}`))
    }
  }
  const version = await waitForCDP()
  const b = new Browser(version)
  return b
}

async function stop() {
  if (!chrome) return
  try { chrome.kill('SIGTERM') } catch (e) {}
  await sleep(300)
  try { chrome.kill('SIGKILL') } catch (e) {}
  chrome = null
}

export { start, stop, chrome }
