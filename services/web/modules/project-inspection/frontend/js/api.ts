import { postJSON } from '@/infrastructure/fetch-json'
import type { ProjectInspectionResult } from './types'

export function analyzeProject(
  projectId: string,
  entryPointIds: string[],
  signal: AbortSignal
) {
  return postJSON<ProjectInspectionResult>(
    `/project/${projectId}/project-inspection/analyze`,
    {
      body: { entryPointIds },
      signal,
    }
  )
}
