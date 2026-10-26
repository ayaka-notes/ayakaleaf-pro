import { streamText } from 'ai'
import { getProvider, resolveModel } from './WorkbenchAiClient.mjs'
import { recordTokenUsage } from './TokenQuota.mjs'

/**
 * Keeps long chats within the model's context window. The browser sends the
 * whole history with every request; once it is estimated at COMPACT_AT_TOKENS,
 * the older turns are summarized and only the recent ones go to the model.
 * The browser keeps the summary and from then on sends it with the messages
 * after it, so each part of the history is summarized once.
 */

// The gateway does not report its context window; 128k is the common one.
export const COMPACT_AT_TOKENS = 100_000
// Recent turns kept verbatim, as many as fit in this budget (at least one).
const KEEP_RECENT_TOKENS = 20_000
// Tool output in the transcript to summarize is clipped to this length.
const TOOL_RESULT_CHARS = 2_000
// An image or rendered PDF page, roughly.
const IMAGE_TOKENS = 1_500

const CJK = /[　-鿿가-힯豈-﫿＀-￯]/g

const SUMMARY_PROMPT = `You summarize the earlier part of a conversation between a user and the Overleaf AI assistant, so that the assistant can continue the conversation from your summary alone.

Write the summary in Markdown with these sections:
- Goal: what the user is working on and wants to achieve.
- Instructions: the user's requests, preferences and constraints.
- Edits: each change proposed to the project, with its file path and what it changed, and whether the user accepted or rejected it.
- Findings: what was learned about the project, such as compile errors, its structure and the packages it uses.
- Open tasks: what is unfinished or was asked for next.

Keep file paths, line numbers, LaTeX commands, labels and citation keys exactly as they appear. Leave out what does not matter for continuing the work. Only state what the transcript shows. Write in the language the user writes in.`

// About 4 characters per token, and a token per CJK character.
function textTokens(text) {
  const cjk = text.match(CJK)?.length ?? 0
  return cjk + Math.ceil((text.length - cjk) / 4)
}

function isToolPart(part) {
  return part.type.startsWith('tool-') || part.type === 'dynamic-tool'
}

function toolName(part) {
  return part.type === 'dynamic-tool' ? part.toolName : part.type.slice(5)
}

function partTokens(part) {
  if (part.type === 'text' || part.type === 'reasoning') {
    return textTokens(part.text)
  }
  if (part.type === 'file') return IMAGE_TOKENS
  if (isToolPart(part)) {
    const input = textTokens(JSON.stringify(part.input ?? ''))
    // view_page returns the page as base64 PNG
    if (toolName(part) === 'view_page') return input + IMAGE_TOKENS
    return input + textTokens(JSON.stringify(part.output ?? part.errorText ?? ''))
  }
  return 0
}

function messageTokens(message) {
  return message.parts.reduce((sum, part) => sum + partTokens(part), 0)
}

/**
 * Where the kept turns start: the oldest user message whose turns fit in
 * KEEP_RECENT_TOKENS, or the latest user message if even its turn does not.
 * -1 when there is nothing before it to summarize.
 */
function findCut(messages) {
  let tail = 0
  let cut = -1
  for (let i = messages.length - 1; i > 0; i--) {
    tail += messageTokens(messages[i])
    if (messages[i].role !== 'user') continue
    if (cut !== -1 && tail > KEEP_RECENT_TOKENS) break
    cut = i
  }
  return cut
}

function clip(text) {
  return text.length > TOOL_RESULT_CHARS
    ? `${text.slice(0, TOOL_RESULT_CHARS)} [clipped]`
    : text
}

function transcript(messages, summary) {
  const lines = []
  if (summary) {
    lines.push('Summary of the conversation before this transcript:', summary, '')
  }
  for (const message of messages) {
    lines.push(`## ${message.role === 'user' ? 'User' : 'Assistant'}`)
    for (const part of message.parts) {
      if (part.type === 'text') {
        lines.push(part.text)
      } else if (part.type === 'file') {
        lines.push('[image attached]')
      } else if (isToolPart(part)) {
        const name = toolName(part)
        const output =
          name === 'view_page'
            ? '[rendered PDF page]'
            : clip(JSON.stringify(part.output ?? part.errorText ?? null))
        lines.push(`[tool ${name} ${JSON.stringify(part.input ?? {})}] -> ${output}`)
      }
    }
    lines.push('')
  }
  return lines.join('\n')
}

/**
 * Summarizes the older turns when the history is too long. Returns the new
 * summary, the id of the last summarized message and the messages to keep,
 * or null when the history fits or has nothing to summarize.
 */
export async function compactHistory({ messages, summary, userId }) {
  const total =
    messages.reduce((sum, message) => sum + messageTokens(message), 0) +
    (summary ? textTokens(summary) : 0)
  if (total < COMPACT_AT_TOKENS) return null
  const cut = findCut(messages)
  if (cut === -1) return null

  const head = messages.slice(0, cut)
  const result = streamText({
    model: getProvider()(resolveModel()),
    system: SUMMARY_PROMPT,
    prompt: transcript(head, summary),
    // Errors reject result.text, the caller decides what to do
    onError() {},
  })
  const text = await result.text
  if (userId) {
    await recordTokenUsage(userId, (await result.totalUsage)?.totalTokens)
  }
  if (!text.trim()) return null
  return {
    summary: text,
    upToMessageId: head.at(-1).id,
    messages: messages.slice(cut),
  }
}

export default { compactHistory, COMPACT_AT_TOKENS }
