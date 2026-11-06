/**
 * The conversation: sends messages to /workbench/chat with the editor
 * context, runs the browser tools the model calls, keeps the server's
 * summary of older turns, and shows consent, quota and error notices.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useChat } from '@ai-sdk/react'
import {
  DefaultChatTransport,
  isToolUIPart,
  lastAssistantMessageIsCompleteWithToolCalls,
  type UIMessage,
} from 'ai'
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
import useAiAccess, { useTextExtract } from '../hooks/use-ai-access'
import { useProjectActions } from '../hooks/use-project-actions'
import { TOOLS, type Respond } from '../agent/tools'
import { AiUnavailableError, QuotaExceededError, ToolBudgetError, ToolRefusal } from '../errors'
import MessageView, { CONTEXT_OPEN } from './message-view'
import Composer, { type Draft } from './composer'
import StarterPrompts from './starter-prompts'
import ConsentCard from './consent-card'
import { AiOffNotice, ChatFailedNotice, ChatNotice, QuotaNotice } from './notices'
import { faint, muted, plain, ruleAbove } from './themed'

// The browser offers the server tools; the server adds the configured ones
const SERVER_TOOLS = ['web_search', 'web_fetch', 'search_docs']

/** Set by the server when it summarizes turns up to and including a message. */
type Summary = { summary: string; upToMessageId: string }

type Selection = { fromLine: number; toLine: number; content: string }

/** Settles with work, or rejects as soon as the signal aborts. */
function untilAborted<T>(work: Promise<T>, signal: AbortSignal) {
  return new Promise<T>((resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    work.then(resolve, reject)
  })
}

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

export default function ChatView({
  chatId,
  view,
  initialMessages,
  onMessages,
}: {
  chatId: string
  view: EditorView
  /** overleaf-lab (merge phase 2): seeded turns when a stored conversation is opened. */
  initialMessages?: UIMessage[]
  /** overleaf-lab (merge phase 2): live message report for history persistence. */
  onMessages?: (messages: UIMessage[]) => void
}) {
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
  // overleaf-lab (2026-11): the user’s text-extraction mode — render_pdf_page
  // returns page text instead of a page image so text-only lanes can read it.
  const textExtract = useTextExtract()
  const aiOffHere = getMeta('ol-showAiFeaturesDisabled')
  const { signal } = useAbortController()
  const actions = useProjectActions()
  const actionsRef = useRef(actions)
  actionsRef.current = actions

  const [problem, setProblem] = useState<string | boolean>(false)
  const [quotaHit, setQuotaHit] = useState(false)
  const [summary, setSummary] = useState<Summary | null>(null)
  const summaryRef = useRef<Summary | null>(null)
  // The open file the model was last told about
  const toldPath = useRef<string | null>(null)
  // Browser tools still running, and whether the user stopped the reply
  const running = useRef(new Set<AbortController>())
  const [toolsRunning, setToolsRunning] = useState(0)
  const stopped = useRef(false)

  const { currentDocumentId } = useEditorOpenDocContext()
  const { pathInFolder } = useFileTreePathContext()
  const path = (currentDocumentId && pathInFolder(currentDocumentId)) || 'main.tex'

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
              enabledTools: SERVER_TOOLS,
              // overleaf-lab (merge phase 3): let the shared usage ledger group
              // workbench calls per project (same scoping as the llm endpoint).
              projectId: getMeta('ol-project_id'),
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

  const {
    messages,
    setMessages,
    sendMessage,
    addToolOutput,
    stop,
    status,
  } = useChat({
    id: chatId,
    transport,
    // overleaf-lab (merge phase 2): seeded from the stored conversation on open.
    ...(initialMessages ? { messages: initialMessages } : {}),
    // A tool that ends after Stop must not start the next step
    sendAutomaticallyWhen: options =>
      !stopped.current && lastAssistantMessageIsCompleteWithToolCalls(options),
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
      } else if (error.message === 'ai_pdf_not_supported') {
        // overleaf-lab (2026-11): legacy code path (pre split) — keep handling
        setProblem('The current model cannot read PDF files. Choose a vision-capable model for Chat in LLM settings.')
      } else if (error.message === 'ai_pdf_not_supported_site') {
        // overleaf-lab (ayakaleaf #122 follow-up, 2026-10-28): operator gateway
        // refused the PDF-bearing request — gateway file handling or the
        // AI_PDF_MODEL configuration; the status alone cannot tell which.
        setProblem(
          "The AI service rejected this request containing a PDF. Ask the administrator to check the gateway's PDF file support and the PDF model configuration."
        )
      } else if (error.message === 'ai_pdf_not_supported_byo') {
        // BYO/site lane: the user's model choice (or a text-only model) is the
        // cause — point at the two levers that work for them.
        setProblem(
          'The model for this chat rejected the PDF. Choose a PDF-capable model for Chat in LLM settings, or enable “Read images & PDF attachments as text (OCR)” in your LLM settings.'
        )
      } else if (error.message === 'ai_pdf_unreadable') {
        // overleaf-lab (bug hunt 2026-11): OCR text mode was ON but the server
        // could not extract readable text from this PDF (scanned pages the
        // OCR did not read, or a format it cannot open). Saying "enable OCR" 
        // would be wrong — it was already on.
        setProblem(
          'The "read as text" mode was on, but the server could not extract usable text from this PDF (it may be a blurry scan or an unsupported format). If the text is important, re-save the PDF with a text layer, or pick a PDF-capable model for Chat in your LLM settings.'
        )
      } else if (error.message === 'ai_image_not_supported_byo') {
        // overleaf-lab (2026-11, owner report): the attached image was routed
        // to a text-only model and the provider rejected it ("not a
        // multimodal model"). BYO lane: the user holds the fix — pick an
        // image-capable model for the chat slot or use the OCR text mode.
        setProblem(
          'Your model cannot see images. Pick an image-capable model for Chat in your LLM settings (File → LLM settings) — or enable “Read images & PDF attachments as text (OCR)” in your LLM settings and the image will be read as text instead.'
        )
      } else if (error.message === 'ai_image_unreadable') {
        // overleaf-lab (bug hunt 2026-11): OCR text mode was ON but Tesseract 
        // could not read this image. Distinct from "mode is off" — the user
        // already enabled it, so the remedy is about the image or the model.
        setProblem(
          'The "read as text" mode was on, but the server could not read text from this image (it may be too blurry, or a format the OCR cannot open). Try a clearer image, or pick an image-capable model for Chat in your LLM settings (File → LLM settings).'
        )
      } else if (error.message === 'ai_image_not_supported_site') {
        // Site/operator lane: no vision model is enabled server-side.
        setProblem(
          'No image-capable model is enabled for this chat. Ask your administrator to enable a vision model, or enable “Read images & PDF attachments as text (OCR)” in your LLM settings.'
        )
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
      // Stop and closing the panel both end the tool
      const controller = new AbortController()
      const abort = () => controller.abort()
      signal.addEventListener('abort', abort)
      running.current.add(controller)
      setToolsRunning(running.current.size)
      try {
        const output = await untilAborted(
          Promise.resolve().then(() =>
            tool.run!(toolCall.input, {
              view,
              openPath: path,
              actions: actionsRef.current,
              signal: controller.signal,
              textExtract,
            })
          ),
          controller.signal
        )
        addToolOutput({ tool: toolCall.toolName, toolCallId: toolCall.toolCallId, output: output ?? null } as any)
      } catch (error) {
        const aborted = controller.signal.aborted
        addToolOutput({
          tool: toolCall.toolName,
          toolCallId: toolCall.toolCallId,
          state: 'output-error',
          errorText: aborted
            ? 'Stopped by the user.'
            : error instanceof Error
              ? error.message
              : String(error),
        } as any)
        if (!aborted && !(error instanceof ToolRefusal)) setProblem(true)
      } finally {
        signal.removeEventListener('abort', abort)
        running.current.delete(controller)
        setToolsRunning(running.current.size)
      }
    },
  })

  // overleaf-lab (merge phase 2): report the live messages upward so the panel
  // can persist them (debounced there). The initial report covers seeded turns.
  const onMessagesRef = useRef(onMessages)
  onMessagesRef.current = onMessages
  useEffect(() => {
    onMessagesRef.current?.(messages)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages])

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

  const stopReply = useCallback(() => {
    stopped.current = true
    running.current.forEach(controller => controller.abort())
    stop()
  }, [stop])

  const { editorSelection } = useEditorSelectionContext()
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
      stopped.current = false
      // An edit still waiting for Apply or Reject would reach the model as a
      // call without a result, which the gateway refuses
      setMessages(current =>
        current.map(message => ({
          ...message,
          parts: message.parts.map(part =>
            isToolUIPart(part) && part.type === 'tool-propose_edit' && part.state === 'input-available'
              ? {
                  ...part,
                  state: 'output-error' as const,
                  errorText: 'The user wrote again without applying or rejecting this edit; it was not applied.',
                }
              : part
          ),
        }))
      )
      // The context goes with the first message, whenever text is selected
      // and when another file is open than the model was last told
      const withContext =
        toldPath.current !== path || selection.length > 0
          ? `${draft.text}\n\n${contextBlock(path, selection)}`
          : draft.text
      toldPath.current = path
      sendMessage({ text: withContext, files: draft.files })
    },
    [canChat, path, selection, sendMessage, setMessages]
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
          working={status === 'submitted' || status === 'streaming' || toolsRunning > 0}
          selectionNote={selectionNote}
          onSend={send}
          onStop={stopReply}
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
