import logger from '@overleaf/logger'
import Metrics from '@overleaf/metrics'
import { z, zz, parseReq } from '../../../../app/src/infrastructure/Validation.mjs'
import ProjectInspectionManager from './ProjectInspectionManager.mjs'
import { ProjectInspectionError } from './ProjectInspectionErrors.mjs'

const analyzeSchema = z.object({
  params: z.object({
    project_id: zz.objectId(),
  }),
  body: z.object({
    entryPointIds: z.array(zz.objectId()).min(1).max(50),
  }),
})

async function analyze(req, res, next) {
  const abortController = new AbortController()
  const onAborted = () => abortController.abort()
  req.once('aborted', onAborted)

  try {
    const { params, body } = parseReq(req, analyzeSchema)
    const projectId = params.project_id.toString()
    const entryPointIds = [...new Set(body.entryPointIds.map(String))]
    const startedAt = performance.now()

    const result = await ProjectInspectionManager.analyze(
      projectId,
      entryPointIds,
      { signal: abortController.signal }
    )

    Metrics.inc('project-inspection-analysis', 1, { status: 'success' })
    Metrics.histogram(
      'project-inspection-analysis-duration',
      performance.now() - startedAt,
      [100, 250, 500, 1000, 2000, 5000, 10_000, 30_000],
      { status: 'success' }
    )
    res.json(result)
  } catch (error) {
    Metrics.inc('project-inspection-analysis', 1, {
      status: error?.code ?? 'error',
    })
    if (error instanceof ProjectInspectionError) {
      if (error.statusCode === 499 && (req.aborted || res.destroyed)) {
        return
      }
      logger.warn(
        { err: error, projectId: req.params.project_id },
        'project inspection request failed'
      )
      return res.status(error.statusCode).json({
        error: error.code,
        message: error.message,
      })
    }
    next(error)
  } finally {
    req.off('aborted', onAborted)
  }
}

export default { analyze }
