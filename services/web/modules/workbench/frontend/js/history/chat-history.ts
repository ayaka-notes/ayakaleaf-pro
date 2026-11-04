/**
 * overleaf-lab (2026-11, merge phase 2): workbench AI-assistant chat history.
 *
 * Reuses the SAME browser-side store the llm module shipped for issue #119
 * (IndexedDB `ol-llm-chat-history`, per-project, zero dependencies, capped at
 * 50 conversations / 200 messages / ~4M chars). Sharing the store means the
 * conversations a user already has from the old chat pane appear in the
 * workbench history automatically — that IS the migration, and no data is
 * lost when the old pane is retired.
 *
 * Workbench messages are AI-SDK UI messages (parts: text, tools, files...);
 * the store keeps the durable TEXT of each turn (what the user reads and
 * exports). Tool cards and file attachments are not stored: they are
 * re-rendered from the live stream, and their source (the project document)
 * is always re-fetchable through the tools.
 */
import type { UIMessage } from 'ai'
import {
  clearProject,
  deriveConversationTitle,
  loadProject,
  makeConversationId,
  saveProject,
  type StoredConversation,
  type StoredMessage,
} from '../../../llm/frontend/js/utils/llm-chat-storage'
import getMeta from '@/utils/meta'

/** First user text with the injected <editor-context> block removed. */
function stripContextBlock(text: string): string {
  const open = text.indexOf('<editor-context>')
  if (open === -1) return text
  const close = text.indexOf('</editor-context>', open)
  const head = text.slice(0, open)
  const tail = close === -1 ? '' : text.slice(close + '</editor-context>'.length)
  return `${head}${tail}`.trim()
}

function messageText(message: UIMessage): string {
  if (message.role !== 'user' && message.role !== 'assistant') return ''
  const parts = Array.isArray(message.parts) ? message.parts : []
  return parts
    .filter(part => part.type === 'text' && typeof part.text === 'string')
    .map(part => part.text)
    .join('\n')
    .trim()
}

/** UI messages -> stored text turns (drops tool-only and empty turns). */
export function flattenMessages(messages: UIMessage[]): StoredMessage[] {
  const out: StoredMessage[] = []
  for (const message of messages) {
    const text = stripContextBlock(messageText(message))
    if (!text) continue
    out.push({ role: message.role as 'user' | 'assistant', content: text })
  }
  return out
}

/** Stored text turns -> fresh UI messages (new ids, so the stream continues). */
export function hydrateMessages(messages: StoredMessage[]): UIMessage[] {
  return messages.map(stored => ({
    id: makeConversationId(),
    role: stored.role,
    parts: [{ type: 'text', text: stored.content }],
  }))
}

export function getProjectId(): string | null {
  const id = getMeta('ol-project_id')
  return typeof id === 'string' && id ? id : null
}

export async function listConversations(): Promise<StoredConversation[]> {
  const projectId = getProjectId()
  if (!projectId) return []
  const history = await loadProject(projectId)
  if (!history) return []
  return history.conversations.slice().sort((a, b) => b.updatedAt - a.updatedAt)
}

export function conversationById(id: string, list: StoredConversation[]): StoredConversation | null {
  return list.find(conversation => conversation.id === id) ?? null
}

/**
 * Persist (upsert) one conversation under the given id. Resolves true when the
 * write landed; false is a no-op (IDB unavailable) and chat keeps working
 * exactly as in-memory.
 */
export async function saveConversation(id: string, messages: StoredMessage[]): Promise<boolean> {
  const projectId = getProjectId()
  if (!projectId) return false
  if (!messages.length) return false
  const history =
    (await loadProject(projectId)) || {
      projectId,
      activeId: null,
      conversations: [] as StoredConversation[],
    }
  const existing = history.conversations.find(conversation => conversation.id === id)
  const updated: StoredConversation = {
    id,
    title: deriveConversationTitle(messages),
    updatedAt: Date.now(),
    messages,
  }
  history.conversations = existing
    ? history.conversations.map(conversation => (conversation.id === id ? updated : conversation))
    : [...history.conversations, updated]
  history.activeId = id
  return saveProject(history)
}

export async function removeConversation(id: string): Promise<void> {
  const projectId = getProjectId()
  if (!projectId) return
  const history = await loadProject(projectId)
  if (!history) return
  history.conversations = history.conversations.filter(conversation => conversation.id !== id)
  if (history.activeId === id) history.activeId = null
  await saveProject(history)
}

export async function clearAllConversations(): Promise<void> {
  const projectId = getProjectId()
  if (projectId) await clearProject(projectId)
}

/** Markdown document for export (issue #119: one .md per conversation). */
export function conversationToMarkdown(conversation: StoredConversation): string {
  const lines: string[] = []
  lines.push(`# ${conversation.title}`)
  lines.push('')
  lines.push(`_Exported ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC_`)
  lines.push('')
  for (const message of conversation.messages) {
    lines.push(`**${message.role === 'user' ? 'You' : 'Assistant'}:**`)
    lines.push('')
    lines.push(message.content)
    lines.push('')
  }
  return lines.join('\n')
}

export function downloadMarkdown(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename || 'chat-history.md'
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  // Let the click flush before the blob is released.
  window.setTimeout(() => URL.revokeObjectURL(url), 2000)
}
