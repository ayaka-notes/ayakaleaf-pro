import { Worker } from 'node:worker_threads'
import pLimit from 'p-limit'
import {
  AnalysisCancelledError,
  AnalysisTimeoutError,
  ProjectInspectionError,
} from './ProjectInspectionErrors.mjs'

const MAX_CONCURRENCY = parsePositiveInteger(
  process.env.PROJECT_INSPECTION_WORKER_CONCURRENCY,
  2
)
const TIMEOUT_MS = parsePositiveInteger(
  process.env.PROJECT_INSPECTION_TIMEOUT_MS,
  30_000
)
const limit = pLimit(MAX_CONCURRENCY)

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

async function run(snapshot, { signal } = {}) {
  if (signal?.aborted) throw new AnalysisCancelledError()

  return await limit(() => {
    if (signal?.aborted) throw new AnalysisCancelledError()
    return new Promise((resolve, reject) => {
      const worker = new Worker(
        new URL('./analyzer/analysis-worker.mjs', import.meta.url),
        { workerData: snapshot }
      )
      let settled = false

      const finish = (callback, value) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        signal?.removeEventListener('abort', onAbort)
        callback(value)
      }

      const onAbort = () => {
        worker.terminate().catch(() => {})
        finish(reject, new AnalysisCancelledError())
      }

      const timeout = setTimeout(() => {
        worker.terminate().catch(() => {})
        finish(reject, new AnalysisTimeoutError())
      }, TIMEOUT_MS)

      signal?.addEventListener('abort', onAbort, { once: true })
      if (signal?.aborted) {
        onAbort()
        return
      }
      worker.once('message', message => {
        if (message?.ok) {
          finish(resolve, message.result)
        } else {
          finish(
            reject,
            new ProjectInspectionError(
              message?.error?.message ?? 'Project inspection worker failed',
              { code: message?.error?.code }
            )
          )
        }
      })
      worker.once('error', error => {
        finish(
          reject,
          new ProjectInspectionError('Project inspection worker failed', {
            cause: error,
          })
        )
      })
      worker.once('exit', code => {
        if (code !== 0 && !settled) {
          finish(
            reject,
            new ProjectInspectionError(
              `Project inspection worker exited with code ${code}`
            )
          )
        }
      })
    })
  })
}

export default { run }
