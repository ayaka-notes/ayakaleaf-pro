import { GetUsersResponseBody, Sort, User } from '../../../../types/user/api'
import { deleteJSON, getJSON, postJSON, putJSON } from '@/infrastructure/fetch-json'

export function getUsers(sortBy: Sort): Promise<GetUsersResponseBody> {
  return postJSON('/admin/users', { body: { sort: sortBy } })
}

export function searchUsers(search: string, signal?: AbortSignal): Promise<GetUsersResponseBody> {
  return postJSON('/admin/users/search', { body: { search }, signal })
}

export function updateUser(userId: string, userData: Partial<User>) {
  return postJSON(`/admin/user/${userId}/update`, { body: userData })
}

export function deleteUser(
  userId: string,
  options: {
    sendEmail: boolean
    toUserId: string | null
  }
) {
  return postJSON(`/admin/user/${userId}/delete`, { body: options } )
}

export function restoreUser(userId: string) {
  return postJSON(`/admin/user/${userId}/restore`)
}

export function purgeUser(userId: string) {
  return deleteJSON(`/admin/user/${userId}`)
}

export function getAdditionalUserInfo(userId: string) {
  return getJSON(`/admin/user/${userId}/info`)
}

export type AiUsage = { used: number; limit: number | null }

export function getAiUsage(userId: string): Promise<AiUsage> {
  return getJSON(`/admin/user/${userId}/ai-usage`)
}

export function resetAiUsage(userId: string): Promise<AiUsage> {
  return postJSON(`/admin/user/${userId}/ai-usage/reset`)
}
// overleaf-lab (2026-11-05, TODO-9613994b): the LLM ledger usage of ONE user
// (same numbers as that user's own /user/llm-settings Usage block), plus the
// user's current model selection so the admin can see which lane each task
// resolves to.
export type LlmUsageSelection = {
  default: string
  tasks: Record<string, string>
  rowNames: Record<string, string>
}
export type LlmUsage = {
  days: number
  calls: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  byDay: Array<{ day: string; calls: number; totalTokens: number }>
  byAction: Array<{ action: string; calls: number; totalTokens: number }>
  byModel: Array<{ model: string; calls: number; totalTokens: number }>
  selection: LlmUsageSelection
}
export function getLlmUsage(userId: string, days = 30): Promise<LlmUsage> {
  return getJSON(`/admin/llm/usage/${userId}?days=${days}`)
}

// overleaf-lab (owner request 2026-11-05): per-user MCP service override.
// Tri-state: 'default' follows the site switch, 'enabled' force-allows,
// 'disabled' denies the user (403 at the MCP endpoint).
export type McpUserMode = 'default' | 'enabled' | 'disabled'

export function getMcpUserMode(userId: string): Promise<{ ok: boolean; mode: McpUserMode }> {
  return getJSON(`/admin/llm/mcp-user/${userId}`)
}

export function setMcpUserMode(userId: string, mode: McpUserMode): Promise<{ ok: boolean; mode: McpUserMode }> {
  return putJSON(`/admin/llm/mcp-user/${userId}`, { mode })
}

export function sendRegEmail(userId: string) {
  return postJSON(`/admin/user/${userId}/send-activation`)
}
