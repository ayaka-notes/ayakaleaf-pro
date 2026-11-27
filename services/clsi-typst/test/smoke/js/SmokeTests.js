import { fetchJson } from '@overleaf/fetch-utils'
import Settings from '@overleaf/settings'

const buildUrl = path =>
  `http://${Settings.internal.clsi.host}:${Settings.internal.clsi.port}/${path}`

const url = buildUrl(`project/smoketest-${process.pid}/compile`)

// A small Typst document that exercises: text, a heading, math, a table and
// a bibliography (citations resolve through the vendored universe in the
// compiler image). Kept small so the smoke test stays fast.
const SMOKE_TYP = `
#heading("Smoke test")

Hello, **world** from clsi-typst.

$ x^2 $

#table(
  columns: (auto, auto),
  ("A", "B"),
  ("1", "2"),
)

@smith2020

#bibliography("references.bib")
`

const SMOKE_BIB = `
@smith2020,
  author = {Smith, Jane},
  title = {A smoke test reference},
  year = {2020},
  type = {article},
`

export default {
  async sendNewResult(res) {
    let error
    try {
      await this._run()
    } catch (err) {
      error = err
    }

    this._sendResponse(res, error)
  },
  sendLastResult(res) {
    this._sendResponse(res, this._lastError)
  },
  triggerRun(cb) {
    this._run()
      .then(() => {
        this._lastError = null
        cb()
      })
      .catch(error => {
        this._lastError = error
        cb(error)
      })
  },
  lastRunSuccessful() {
    return this._lastError == null
  },

  _lastError: new Error('SmokeTestsPending'),
  _sendResponse(res, error) {
    let code, body
    if (error) {
      code = 500
      body = error.message
    } else {
      code = 200
      body = 'OK'
    }
    res.contentType('text/plain')
    res.status(code).send(body)
  },
  async _run() {
    const body = await fetchJson(url, {
      method: 'POST',
      json: {
        compile: {
          options: {
            metricsPath: 'health-check',
            compiler: 'typst',
          },
          resources: [
            { path: 'main.typ', content: SMOKE_TYP },
            { path: 'references.bib', content: SMOKE_BIB },
          ],
        },
      },
      timeout: 60000,
      rejectOnError: false,
    })
    if (
      body.compile?.status === 'success' &&
      body.compile?.outputFiles?.some(f => f.path === 'output.pdf' && f.size > 0)
    ) {
      return
    }
    throw new Error(
      `smoke test failed: status=${body.compile?.status} files=${
        body.compile?.outputFiles?.length
      }`
    )
  },
}
