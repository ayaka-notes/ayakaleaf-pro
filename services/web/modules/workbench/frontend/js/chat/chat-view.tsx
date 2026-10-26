/**
 * The conversation: sends messages to /workbench/chat with the editor
 * context, runs the browser tools the model calls, keeps the server's
 * summary of older turns, and shows consent, quota and error notices.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls, type UIMessage } from 'ai'
import type { EditorView } from '@codemirror/view'
import getMeta from '@/utils/meta'
import { debugConsole } from '@/utils/debugging'
import { useEditorContext } from '@/shared/context/editor-context'
import { useEditorSelectionContext } from '@/shared/context/editor-selection-context'
import { useEditorOpenDocContext } from '@/features/ide-react/context/editor-open-doc-context'
import { useFileTreePathContext } from '@/features/file-tree/contexts/file-tree-path'
import useAiConsent from '@/shared/hooks/use-ai-consent'
import useAbortController from '@/shared/hooks/use-abort-controller'
import AiPaywallNotification from '@/shared/components/ai-paywall-notification'
import useAiAccess from '../hooks/use-ai-access'
import { useProjectActions } from '../hooks/use-project-actions'
import { TOOLS, type Respond } from '../agent/tools'
import { AiUnavailableError, QuotaExceededError, ToolBudgetError, ToolRefusal } from '../errors'
import MessageView, { CONTEXT_OPEN } from './message-view'
import Composer, { type Draft } from './composer'
import StarterPrompts from './starter-prompts'
import ConsentCard from './consent-card'
import { AiOffNotice, ChatFailedNotice, ChatNotice, QuotaNotice } from './notices'
import { faint, muted, plain, ruleAbove } from './themed'

// The browser offers both searches; the server adds the configured ones
const SEARCH_TOOLS = ['web_search', 'search_docs']

/** Set by the server when it summarizes turns up to and including a message. */
type Summary = { summary: string; upToMessageId: string }

type Selection = { fromLine: number; toLine: number; content: string }

function contextBlock(path: string, selection: Selection[]) {
  const lines = [CONTEXT_OPEN, `Open file: ${path}`]
  for (const range of selection) {
    lines.push(`Selected lines ${range.fromLine}-${range.toLine}:`, range.content)
  }
  lines.push('</editor-context>')
  return lines.join('\n')
}

/** Keeps the newest message in view unless the user has scrolled up. */
function useFollowBottom(trigger: unknown) {
  const box = useRef<HTMLDivElement>(null)
  const following = useRef(true)
  useEffect(() => {
    const element = box.current
    if (element && following.current) {
      element.scrollTop = element.scrollHeight
    }
  }, [trigger])
  const onScroll = useCallback(() => {
    const element = box.current
    if (element) {
      following.current = element.scrollHeight - element.scrollTop - element.clientHeight < 40
    }
  }, [])
  return { box, onScroll }
}

export default function ChatView({ chatId, view }: { chatId: string; view: EditorView }) {
  const {
    hasSuggestionsLeft,
    premiumSuggestionResetDate,
    setSuggestionsLeft,
    setPremiumSuggestionResetDate,
    hasTokensLeft,
    setTokensLeft,
    tokenResetDate,
    setTokenResetDate,
  } = useEditorContext()
  const { hasGivenAiConsent } = useAiConsent()
  const hasAccess = useAiAccess()
  const aiOffHere = getMeta('ol-showAiFeaturesDisabled')
  const { signal } = useAbortController()
  const actions = useProjectActions()
  const actionsRef = useRef(actions)
  actionsRef.current = actions

  const [problem, setProblem] = useState<string | boolean>(false)
  const [quotaHit, setQuotaHit] = useState(false)
  const [summary, setSummary] = useState<Summary | null>(null)
  const summaryRef = useRef<Summary | null>(null)

  const now = new Date()
  const canChat =
    hasGivenAiConsent &&
    hasAccess &&
    !aiOffHere &&
    (hasSuggestionsLeft || premiumSuggestionResetDate < now) &&
    (hasTokensLeft || tokenResetDate < now)

  // Quota headers feed the core editor state that the paywall notice reads
  const readQuotaHeaders = useCallback(
    (response: Response) => {
      const header = (name: string) => response.headers.get(name)
      const resetIn = (name: string) => new Date(Date.now() + parseInt(header(name) || '0') * 1000)
      if (header('RateLimit-Reset')) {
        setPremiumSuggestionResetDate(resetIn('RateLimit-Reset'))
        setSuggestionsLeft(parseInt(header('RateLimit-Remaining') || '0'))
      }
      if (header('Token-RateLimit-Reset')) {
        setTokenResetDate(resetIn('Token-RateLimit-Reset'))
        setTokensLeft(parseInt(header('Token-RateLimit-Remaining') || '0'))
      }
    },
    [setPremiumSuggestionResetDate, setSuggestionsLeft, setTokenResetDate, setTokensLeft]
  )
  const readQuotaRef = useRef(readQuotaHeaders)
  readQuotaRef.current = readQuotaHeaders

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: '/workbench/chat',
        headers: { 'X-Csrf-Token': getMeta('ol-csrfToken') },
        // Turns the server summarized are replaced by the summary
        prepareSendMessagesRequest({ id, messages, trigger, messageId }) {
          const kept = summaryRef.current
          const from = kept ? messages.findIndex(m => m.id === kept.upToMessageId) + 1 : 0
          return {
            body: {
              id,
              trigger,
              messageId,
              messages: messages.slice(from),
              summary: kept?.summary,
              enabledTools: SEARCH_TOOLS,
            },
          }
        },
        async fetch(input, init) {
          const response = await fetch(input, init)
          readQuotaRef.current(response)
          if (response.status === 403) throw new AiUnavailableError()
          if (response.status === 409) throw new ToolBudgetError()
          if (response.status === 429) throw new QuotaExceededError()
          return response
        },
      }),
    []
  )

  const { messages, sendMessage, addToolOutput, stop, status } = useChat({
    id: chatId,
    transport,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    onData(part) {
      if (part.type === 'data-compaction') {
        summaryRef.current = part.data as Summary
        setSummary(part.data as Summary)
      }
    },
    onError(error) {
      if (error instanceof QuotaExceededError) {
        setQuotaHit(true)
      } else if (error instanceof ToolBudgetError) {
        setProblem(error.message)
      } else {
        debugConsole.error(error)
        setProblem(true)
      }
    },
    async onToolCall({ toolCall }) {
      if (toolCall.dynamic) return
      const tool = TOOLS[toolCall.toolName]
      // Server tools and the edit proposal are answered elsewhere
      if (!tool?.run) return
      try {
        const output = await tool.run(toolCall.input, { view, actions: actionsRef.current, signal })
        addToolOutput({ tool: toolCall.toolName, toolCallId: toolCall.toolCallId, output: output ?? null } as any)
      } catch (error) {
        addToolOutput({
          tool: toolCall.toolName,
          toolCallId: toolCall.toolCallId,
          state: 'output-error',
          errorText: error instanceof Error ? error.message : String(error),
        } as any)
        if (!(error instanceof ToolRefusal)) setProblem(true)
      }
    },
  })

  // A new chat must not keep running when the panel goes away
  const stopRef = useRef(stop)
  stopRef.current = stop
  useEffect(
    () => () => {
      stopRef.current()
    },
    []
  )

  const respond = useCallback<Respond>(output => addToolOutput(output as any), [addToolOutput])

  const { editorSelection } = useEditorSelectionContext()
  const { currentDocumentId } = useEditorOpenDocContext()
  const { pathInFolder } = useFileTreePathContext()
  const path = (currentDocumentId && pathInFolder(currentDocumentId)) || 'main.tex'
  const selection: Selection[] = useMemo(() => {
    const { doc } = view.state
    return (editorSelection?.ranges ?? [])
      .filter((range: any) => !range.empty)
      .map((range: any) => {
        const from = Math.min(range.from, doc.length)
        const to = Math.min(range.to, doc.length)
        return { fromLine: doc.lineAt(from).number, toLine: doc.lineAt(to).number, content: doc.sliceString(from, to) }
      })
  }, [editorSelection, view])

  const send = useCallback(
    (draft: Draft) => {
      if (!canChat) return
      setProblem(false)
      // The context goes with the first message and whenever text is selected
      const withContext =
        messages.length === 0 || selection.length > 0
          ? `${draft.text}\n\n${contextBlock(path, selection)}`
          : draft.text
      sendMessage({ text: withContext, files: draft.files })
    },
    [canChat, messages.length, path, selection, sendMessage]
  )

  const { box, onScroll } = useFollowBottom(messages)
  const selectionNote = selection.length
    ? `${path.split('/').pop()}: ${selection.map(r => (r.fromLine === r.toLine ? r.fromLine : `${r.fromLine}-${r.toLine}`)).join(', ')}`
    : undefined

  let body
  if (hasAccess && !hasGivenAiConsent) {
    body = <ConsentCard />
  } else if (messages.length === 0) {
    body = (
      <StarterPrompts
        withSelection={selection.length > 0}
        onPick={text => send({ text, files: [] })}
        disabled={!canChat}
      />
    )
  } else {
    body = messages.map((message: UIMessage) => (
      <div className="d-flex flex-column gap-2" key={message.id}>
        <MessageView
          message={message}
          streaming={status === 'streaming' && message.id === messages.at(-1)?.id}
          respond={respond}
        />
        {message.id === summary?.upToMessageId && (
          <div className="small text-center pt-1" style={{ ...muted, ...ruleAbove }}>
            The assistant now sees the messages above as a summary.
          </div>
        )}
      </div>
    ))
  }

  return (
    // The editor's panels use the 14px body size; the disclaimer 12px
    <div className="d-flex flex-column h-100" style={{ ...plain, fontSize: 'var(--font-size-02)' }}>
      <div
        ref={box}
        onScroll={onScroll}
        className="flex-grow-1 overflow-auto p-2 d-flex flex-column gap-3"
        // A flex item is as tall as its content unless allowed to shrink
        style={{ minHeight: 0 }}
      >
        {body}
        {aiOffHere && <AiOffNotice />}
      </div>
      {hasAccess &&
        (getMeta('ol-showAiFeatures') ? (
          <AiPaywallNotification isActionBelowContent featureLocation="workbench" />
        ) : (
          !hasTokensLeft && tokenResetDate > now && <QuotaNotice resetsAt={tokenResetDate} />
        ))}
      <div data-chat-input="" {...(canChat ? {} : ({ inert: '' } as any))} className={canChat ? undefined : 'opacity-50'}>
        {problem && !quotaHit && (
          typeof problem === 'string' ? <ChatNotice type="error" text={problem} /> : <ChatFailedNotice />
        )}
        <Composer
          status={status}
          selectionNote={selectionNote}
          onSend={send}
          onStop={stop}
          onProblem={message => setProblem(message)}
        />
        {/* One line, or a break after the first sentence */}
        <p
          className="d-flex flex-wrap justify-content-center mb-2"
          style={{ ...faint, fontSize: 'var(--font-size-01)', columnGap: '0.5ch' }}
        >
          <span className="text-nowrap">AI can make mistakes.</span>
          <span className="text-nowrap">Always check responses.</span>
        </p>
      </div>
    </div>
  )
}
