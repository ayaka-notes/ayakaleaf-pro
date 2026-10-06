import {
  GetProjectsResponseBody,
  Sort,
} from '../../../../types/project/api'
import { deleteJSON, postJSON } from '@/infrastructure/fetch-json'

export type TransferOwnershipOptions = {
  user_id: string
  skipEmails: boolean
}

export function getProjects( 
  params: { 
    userId: string, 
    by: Sort['by']
    order: Sort['order']
  }): Promise<GetProjectsResponseBody> {
  const { userId, ...sort } = params
  return postJSON(`/admin/user/${userId}/projects`, { body: { sort } })
}

export function searchProjects(search: string, userId?: string, signal?: AbortSignal): Promise<GetProjectsResponseBody> {
  return postJSON('/admin/projects/search', { body: { search, userId }, signal })
}

export function deleteProject(projectId: string) {
  return deleteJSON(`/project/${projectId}`)
}

export function purgeProject(projectId: string) {
  return deleteJSON(`/admin/project/${projectId}/purge`)
}

export function undeleteProject(projectId: string, userId: string) {
  return postJSON(`/admin/project/${projectId}/undelete`, { body: { userId } })
}

export function trashProjectForUser(projectId: string, userId: string) {
  return postJSON(`/admin/project/${projectId}/trash`, { body: { userId } })
}

export function untrashProjectForUser(projectId: string, userId: string) {
  return postJSON(`/admin/project/${projectId}/untrash`, { body: { userId } })
}
export function transferProjectOwnership(projectId: string, options: TransferOwnershipOptions) {
  // CE 6.3 validates this body with a strict schema that only accepts user_id
  return postJSON(`/project/${projectId}/transfer-ownership`, { body: { user_id: options.user_id } })
}
