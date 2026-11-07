import { postWithCsrf } from './request'

// The workbench and error-assistant modules against services/ai-mock. The
// control API queues the model's replies and reads back what Overleaf sent.

export type Reply = {
  text?: string
  reasoning?: string
  toolCalls?: { name: string; args: Record<string, unknown> }[]
  usage?: { prompt: number; completion: number }
  // Fail the request with this status instead
  status?: number
}

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | { type: string; text?: string }[] | null
  tool_calls?: { function: { name: string; arguments: string } }[]
}

export type ChatRequest = {
  model: string
  tools: string[]
  messages: ChatMessage[]
}

export function aiMock(method: 'GET' | 'POST' | 'PUT', path: string, body?: object) {
  return cy.request({
    method,
    url: `http://ai-mock:8080/_mock${path}`,
    body,
  })
}

export function queueReplies(...replies: Reply[]) {
  aiMock('PUT', '/replies', { replies })
}

export function chatRequests(): Cypress.Chainable<ChatRequest[]> {
  return aiMock('GET', '/requests').its('body')
}

// The text of a message, whether sent as a string or as parts
export function messageText(message: ChatMessage) {
  if (typeof message.content === 'string') return message.content
  return (message.content || []).map(part => part.text || '').join('')
}

// Accepts the AI terms the way the consent prompt does
export function giveAiConsent() {
  cy.visit('/project')
  postWithCsrf('/tutorial/workbench-consent-release/complete', {})
    .its('status')
    .should('equal', 204)
}

// The id of the logged in user
export function currentUserId(): Cypress.Chainable<string> {
  cy.visit('/project')
  return cy
    .get('meta[name="ol-user_id"]')
    .invoke('attr', 'content') as Cypress.Chainable<string>
}

// Admin only: turns the AI features of a user on or off, like the user
// modal of the admin panel
export function setAiFeatures(userId: string, enabled: boolean) {
  cy.visit('/admin/user')
  postWithCsrf(`/admin/user/${userId}/update`, { aiFeatures: { enabled } })
    .its('status')
    .should('equal', 200)
}

// Admin only: the tokens a user used in this quota period
export function aiUsage(userId: string) {
  return cy.request(`/admin/user/${userId}/ai-usage`).its('body')
}

export function resetAiUsage(userId: string) {
  cy.visit('/admin/user')
  postWithCsrf(`/admin/user/${userId}/ai-usage/reset`, {})
    .its('status')
    .should('equal', 200)
}
