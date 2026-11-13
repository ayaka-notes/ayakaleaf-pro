import { randomUUID } from 'node:crypto'
import ProjectSnapshotReader from './ProjectSnapshotReader.mjs'
import AnalysisWorkerService from './AnalysisWorkerService.mjs'

async function analyze(projectId, entryPointIds, { signal } = {}) {
  const snapshot = await ProjectSnapshotReader.read(projectId, entryPointIds, {
    signal,
  })
  const result = await AnalysisWorkerService.run(snapshot, { signal })
  return {
    schemaVersion: 1,
    analysisId: randomUUID(),
    analyzedAt: new Date().toISOString(),
    ...result,
  }
}

export default { analyze }
