/* eslint-disable no-console -- CLI E2E runner/driver: stdout is the test report */
/**
 * P1 regression test — reviewer's "Out of sync" + duplicated-entry sequence.
 *
 * BUG (reproduced on the deployed build, fixed 2026-08-28 in
 * `frontend/js/vendor/libs/sharejs.js` — own-op dup-echo recognition):
 * editing an entry, then switching away and back to the file used to
 *   1. duplicate the entry in the list (client-side double-application of
 *      the op; the server document stayed correct), and
 *   2. leave the op un-acked forever ('Received an ack for an op with an
 *      outdated version.' + `[inflightOpTimeout] Sending` loop +
 *      `pollSavedStatus: assuming not saved`), surfacing the "Out of sync"
 *      modal on the next edit; a reload showed the (single, correct) entry.
 *
 * This script drives the deployed server with headless Chromium over CDP
 * (see cdp.mjs in this directory) and asserts the FIXED behaviour:
 *   - exactly ONE entry after the switch-away-and-back round trip,
 *   - the edited value present,
 *   - no 'outdated version' ack warnings,
 *   - no `[inflightOpTimeout]` resend loop,
 *   - the document ends in a "saved" state.
 *
 * Run (credentials via env only — never commit them):
 *   OVERLEAF_USER=... OVERLEAF_PASS=... \
 *   OVERLEAF_BASE=https://psintern.neuro.uni-bremen.de \
 *   P1_PID=<project-id> node test/e2e/out-of-sync-repro.mjs
 * Exit code 0 = PASS, 1 = FAIL (assertion list in output).
 */
import { start, stop } from './cdp.mjs'
import { setTimeout as sleep } from 'node:timers/promises'

const BASE = process.env.OVERLEAF_BASE || 'https://psintern.neuro.uni-bremen.de'
const PID = process.env.P1_PID || '6a79d37427ef7d246ce38bd6'
const PROBE = 'E2E P1 Probe ' + process.pid
const USER = process.env.OVERLEAF_USER
const PASS = process.env.OVERLEAF_PASS
if (!USER || !PASS) { console.error('set OVERLEAF_USER/OVERLEAF_PASS first'); process.exit(2) }

const b = await start()
const t = await b.newTab(BASE + '/project/' + PID + '?debug=true')
const ev = (e, o) => b.evalIn(t, e, Object.assign({ awaitPromise: true, returnByValue: true }, o || {}))
const results = []
const check = (name, ok, detail) => {
  results.push({ name, ok, detail })
  console.log((ok ? 'PASS' : 'FAIL') + ' — ' + name + (detail ? '  [' + detail + ']' : ''))
}

try {
  await sleep(6500)
  if ((await b.url(t)).includes('/login')) {
    await b.type(t, 'input[name="email"]', USER)
    await b.type(t, 'input[name="password"]', PASS)
    await ev(`(() => { const f = document.querySelector('form'); if (f && f.requestSubmit) { f.requestSubmit(); return 1 } const x = document.querySelector('form [type="submit"]'); if (x) x.click(); return 0 })()`)
    for (let i = 0; i < 30; i++) { await sleep(1000); if (!(await b.url(t)).includes('/login')) break }
    check('login', !(await b.url(t)).includes('/login'), await b.url(t))
    await ev(`location.replace('/project/${PID}?debug=true')`)
    await sleep(7500)
  }

  // console capture
  await ev(`(() => {
    window.__t = { logs: [] }
    const cap = (lvl) => (...a) => { window.__t.logs.push(lvl + ': ' + a.map(x => (typeof x === 'string' ? x : (x && x.message) ? x.message : JSON.stringify(x))).join(' ').slice(0, 300)) }
    console.log = cap('log'); console.warn = cap('warn'); console.error = cap('error')
    return true
  })()`)

  const clickLeaf = (name) => ev(`(() => { const l = Array.from(document.querySelectorAll('*')).filter(e => e.childNodes.length === 1 && e.childNodes[0].nodeType === 3 && (e.textContent || '').trim() === ${JSON.stringify(name)}); if (l.length) { l[l.length - 1].dispatchEvent(new MouseEvent('click', { bubbles: true })); return 'ok' } return 'nf' })()`)
  const clickExact = (name) => ev(`(() => { const els = Array.from(document.querySelectorAll('span,button,a,label,div')).filter(e => (e.textContent || '').trim() === ${JSON.stringify(name)} && e.offsetParent !== null); if (els.length) { els[els.length - 1].click(); return 'ok' } return 'nf' })()`)
  const rowAuthors = () => ev(`(() => { const rows = Array.from(document.querySelectorAll('.bibtex-entry-card-clickable')); return rows.map(c => { const a = c.querySelector('.bibtex-entry-card-author'); return a ? (a.textContent || '').trim() : null; }); })()`)

  // 1. open sample.bib → Visual → open first entry
  check('open sample.bib file tab', await clickLeaf('sample.bib') === 'ok')
  await sleep(4000)
  check('switch to Visual mode', await clickExact('Visual') === 'ok')
  await sleep(4500)
  check('entry card visible', await ev(`!!document.querySelector('.bibtex-entry-card-clickable')`))
  await ev(`(() => { const c = document.querySelector('.bibtex-entry-card-clickable'); if (c) { c.dispatchEvent(new MouseEvent('click', { bubbles: true })); return 'ok' } return 'nf' })()`)
  await sleep(3500)
  const formOpen = await ev(`!!document.querySelector('#bibtex-entry-form')`)
  check('entry form opens', formOpen)
  if (!formOpen) throw new Error('cannot continue without the form')
  const beforeAuthor = await ev(`(document.querySelector('#bib-field-author-0') || { value: '' }).value`)
  console.log('  (author before:', JSON.stringify(beforeAuthor) + ')')

  // 2. edit the author (flush happens on the file switch below — the
  //    in-place preview has no Save button by design)
  await b.type(t, '#bib-field-author-0', PROBE)
  await sleep(600)
  check('author edit applied in form', (await ev(`(document.querySelector('#bib-field-author-0') || { value: '' }).value`)) === PROBE)

  // 3. the reviewer's sequence: away to main.tex, back to sample.bib
  await clickLeaf('main.tex')
  await sleep(3500)
  await clickLeaf('sample.bib')
  await sleep(6500)

  const authors = await rowAuthors()
  check('exactly ONE entry after round trip (no duplication)', authors.length === 1, JSON.stringify(authors))
  check('edited author present, no stale original', authors.length === 1 && authors[0] === PROBE, JSON.stringify(authors))

  // give late-arriving echoes a moment, then check the log
  await sleep(3000)
  const logs = await ev(`(window.__t || { logs: [] }).logs`) || []
  const outdated = logs.filter(l => /outdated version/.test(l)).length
  const resends = logs.filter(l => /\[inflightOpTimeout\] Sending/.test(l)).length
  check('no "ack with an outdated version" discards', outdated === 0, String(outdated))
  check('no inflight-op resend loop (5s watchdog window passed)', resends === 0, String(resends))
  // final-state proof of a properly acked op: the watchdog re-sends any
  // un-acked op after INFLIGHT_OP_TIMEOUT (5s); wait one full watchdog
  // window and assert no NEW unsaved/resend/outdated log lines appear.
  const before = logs.length
  await sleep(6000)
  const logs2 = await ev(`(window.__t || { logs: [] }).logs`) || []
  const fresh = logs2.slice(before).join('\n')
  const quiet = !/assuming not saved|Trying op again|outdated version/.test(fresh)
  check('op acked — full watchdog window passes quiet', quiet, (fresh.split('\n').filter(l => /saved|op|version/i.test(l)).slice(-2)).join(' | ') || 'no relevant new lines')

  const modal = await ev(`(document.body.innerText || '').indexOf('Out of sync') !== -1`)
  check('no "Out of sync" modal', !modal)
} finally {
  await stop()
}

const failed = results.filter(r => !r.ok)
console.log('\n' + (results.length - failed.length) + '/' + results.length + ' checks passed')
if (failed.length) {
  console.log('FAILED CHECKS:')
  failed.forEach(r => console.log('  ✗ ' + r.name + (r.detail ? ' [' + r.detail + ']' : '')))
  process.exit(1)
}
process.exit(0)
