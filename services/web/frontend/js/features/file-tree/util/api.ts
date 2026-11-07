import { postJSON } from '../../../infrastructure/fetch-json'
import { debugConsole } from '@/utils/debugging'

export const refreshProjectMetadata = (projectId: string, entityId: string) =>
  postJSON(`/project/${projectId}/doc/${entityId}/metadata`).catch(
    debugConsole.error
  )
