import { parentPort, workerData } from 'node:worker_threads'
import { analyzeProject } from './analyze-project.mjs'

try {
  const result = analyzeProject(workerData)
  parentPort.postMessage({ ok: true, result })
} catch (error) {
  parentPort.postMessage({
    ok: false,
    error: {
      code: error?.code,
      message: error?.message ?? 'Unknown analysis error',
    },
  })
}
