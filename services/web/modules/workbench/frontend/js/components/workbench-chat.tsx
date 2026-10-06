/**
 * Manages the AI chat stream and browser-side tool calls.
 * Sends the current file path and selection as context, renders responses and tool
 * results, and handles consent, access, and usage-limit notices.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import classNames from 'classnames'
import { useChat } from '@ai-sdk/react'
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithToolCalls,
} from 'ai'
import getMeta from '@/utils/meta'
import { debugConsole } from '@/utils/debugging'
import { sendMB } from '@/infrastructure/event-tracking'
import { useEditorContext } from '@/shared/context/editor-context'
import { useEditorSelectionContext } from '@/shared/context/editor-selection-context'
import { useEditorOpenDocContext } from '@/features/ide-react/context/editor-open-doc-context'
import { useFileTreePathContext } from '@/features/file-tree/contexts/file-tree-path'
import useAiAccess from '@modules/workbench/frontend/js/hooks/use-ai-access'
import { useActiveOverallTheme } from '@/shared/hooks/use-active-overall-theme'
import { useFeatureFlag } from '@/shared/context/split-test-context'
import useAiConsent from '@/shared/hooks/use-ai-consent'
import useAbortController from '@/shared/hooks/use-abort-controller'
import AiPaywallNotification from '@/shared/components/ai-paywall-notification'
import Notification from '@/shared/components/notification'
import { formatSecondsToHoursAndMinutes } from '@/shared/utils/time'
import { useTranslation } from 'react-i18next'
import type { EditorView } from '@codemirror/view'
import { useWorkbenchSettings, type WorkbenchTab } from '../context/workbench-settings-context'
import { useWorkbenchFileActions } from '../hooks/use-file-actions'
import { clientTools, serverTools } from '../tools/client-tools'
import { RateLimitError, ForbiddenError, ToolRejectionError, ToolCallLimitError } from '../errors'
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from './conversation'
import { Message, MessageContent } from './message'
import { Response } from './response'
import { Reasoning } from './reasoning'
import { Tool, ToolHeader, ToolContent } from './tool'
import { FilePart } from './file-part'
import {
  PromptInputProvider,
  PromptInput,
  type EditorSelectionRange,
  type PromptSubmitPayload,
} from './prompt-input'
import { ConversationEmptyState } from './empty-state'
import WorkbenchConsent from './consent'
import WorkbenchErrorNotification, { type WorkbenchError } from './error-notification'
import AiAssistantDisabled from './ai-assistant-disabled'

const CONTEXT_MARKER = '--- START CONTEXT'

// Identify message parts for their corresponding renderers.
const isTextPart = (part: any) => part.type === 'text'
const isReasoningPart = (part: any) => part.type === 'reasoning'
const isFilePart = (part: any) => part.type === 'file'
const isToolPart = (part: any) =>
  typeof part.type === 'string' &&
  (part.type.startsWith('tool-') || part.type === 'dynamic-tool')
const getToolName = (part: any) =>
  part.type === 'dynamic-tool' ? part.toolName : part.type.slice('tool-'.length)

/**
 * Displays the quota reset time when the shared usage-limit notice is hidden.
 */
function QuotaLimitNotification({ tokenResetDate }: { tokenResetDate: Date }) {
  const { t } = useTranslation()
  const secondsTillReset = (tokenResetDate.getTime() - Date.now()) / 1000
  return (
    <Notification
      type="info"
      title={t('usage_limit_reached')}
      content={t(
        'youve_reached_the_fair_usage_limit_on_your_plan_you_can_start_chatting_again_in_time',
        { time: formatSecondsToHoursAndMinutes(t, secondsTillReset) }
      )}
      isDismissible={false}
      customIcon={null}
      className="ai-paywall-notification"
    />
  )
}

export default function WorkbenchChat({
  chatId,
  view,
}: {
  chatId: string
  view: EditorView
}) {
  const [error, setError] = useState<WorkbenchError | 'paywalled' | false>(false)
  const {
    hasSuggestionsLeft,
    suggestionsLeft,
    premiumSuggestionResetDate,
    setSuggestionsLeft,
    setPremiumSuggestionResetDate,
    hasTokensLeft,
    tokensLeft,
    setTokensLeft,
    tokenResetDate,
    setTokenResetDate,
  } = useEditorContext()
  const showAiFeaturesDisabled = getMeta('ol-showAiFeaturesDisabled')
  const overallTheme = useActiveOverallTheme()
  const { hasGivenAiConsent } = useAiConsent()
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const { signal } = useAbortController()
  const { enabledTools, setTab, position, model } = useWorkbenchSettings()

  // Check whether the user has access to AI features.
  const hasAiFeatures = useAiAccess()

  const suggestionsOk = hasSuggestionsLeft || premiumSuggestionResetDate < new Date()
  const tokensOk = hasTokensLeft || tokenResetDate < new Date()
  const canChat =
    hasGivenAiConsent && hasAiFeatures && suggestionsOk && tokensOk && !showAiFeaturesDisabled

  const configRef = useRef({ enabledTools, model })
  useEffect(() => {
    configRef.current = { enabledTools, model }
  }, [enabledTools, model])

  const fileActions = useWorkbenchFileActions()
  const fileActionsRef = useRef(fileActions)
  useEffect(() => {
    fileActionsRef.current = fileActions
  }, [fileActions])

  const transportRef = useRef<InstanceType<typeof DefaultChatTransport> | null>(null)
  if (transportRef.current === null) {
    transportRef.current = new DefaultChatTransport({
      api: '/workbench/tex-gpt',
      headers: {
        'X-Csrf-Token': getMeta('ol-csrfToken'),
      },
      body: () => ({
        enabledTools: Array.from(configRef.current.enabledTools),
        model: configRef.current.model,
        chatId,
      }),
      async fetch(input: RequestInfo | URL, init?: RequestInit) {
        const response = await fetch(input, init)
        if (response.headers.get('RateLimit-Reset')) {
          const resetMs = parseInt(response.headers.get('RateLimit-Reset') || '0') * 1000
          setPremiumSuggestionResetDate(new Date(Date.now() + resetMs))
          setSuggestionsLeft(parseInt(response.headers.get('RateLimit-Remaining') || '0'))
        }
        if (response.headers.get('Token-RateLimit-Reset')) {
          const resetMs =
            parseInt(response.headers.get('Token-RateLimit-Reset') || '0') * 1000
          setTokenResetDate(new Date(Date.now() + resetMs))
          setTokensLeft(parseInt(response.headers.get('Token-RateLimit-Remaining') || '0'))
        }
        if (!response.ok) {
          if (response.status === 403) {
            throw new ForbiddenError()
          }
          if (response.status === 409) {
            throw new ToolCallLimitError()
          }
          if (response.status === 429) {
            throw new RateLimitError(response.headers.get('RateLimit-Reset'))
          }
        }
        return response
      },
    })
  }

  const {
    messages,
    stop,
    addToolOutput,
    id,
    sendMessage,
    status,
  } = useChat({
    id: chatId,
    transport: transportRef.current,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    onError(err: unknown) {
      if (err instanceof RateLimitError) {
        setError('paywalled')
      } else if (err instanceof ToolCallLimitError) {
        setError(err.message)
      } else {
        debugConsole.error(err)
        setError(true)
      }
    },
    onFinish(event: unknown) {
      debugConsole.log('finished', event)
    },
    async onToolCall({ toolCall }: { toolCall: any }) {
      debugConsole.log(toolCall)
      if (toolCall.dynamic) {
        return
      }
      const name = toolCall.toolName
      const tool = clientTools[name]
      if (tool) {
        if ('execute' in tool && tool.execute) {
          try {
            const output = await tool.execute(
              toolCall.input,
              view,
              fileActionsRef.current,
              signal
            )
            addToolOutput({
              tool: name,
              toolCallId: toolCall.toolCallId,
              output: output ?? undefined,
            })
          } catch (err: any) {
            debugConsole.error(err)
            addToolOutput({
              state: 'output-error',
              tool: name,
              toolCallId: toolCall.toolCallId,
              errorText: err.message,
            })
            if (!(err instanceof ToolRejectionError) && !(err instanceof RateLimitError)) {
              setError(true)
            }
          }
        }
      } else if (!(name in serverTools)) {
        addToolOutput({
          state: 'output-error',
          tool: name,
          toolCallId: toolCall.toolCallId,
          errorText: 'Unknown tool',
        })
      }
    },
  })

  // abort the stream on unmount
  const stopRef = useRef(stop)
  useEffect(() => {
    stopRef.current = stop
  }, [stop])
  useEffect(
    () => () => {
      stopRef.current()
    },
    []
  )

  const { editorSelection } = useEditorSelectionContext()
  const { currentDocumentId } = useEditorOpenDocContext()
  const { pathInFolder } = useFileTreePathContext()

  const selectionRanges = useMemo<EditorSelectionRange[] | undefined>(() => {
    if (!editorSelection) {
      return
    }
    const { doc } = view.state
    return editorSelection.ranges.map((range: any) => {
      const from = Math.min(doc.length, range.from)
      const to = Math.min(doc.length, range.to)
      return {
        fromLine: doc.lineAt(from).number,
        toLine: doc.lineAt(to).number,
        content: view.state.sliceDoc(from, to),
        empty: range.empty,
      }
    })
  }, [editorSelection, view.state])

  const selectionEmpty = useMemo(
    () => selectionRanges?.every(range => range.empty),
    [selectionRanges]
  )
  const currentPath = useMemo(
    () => (currentDocumentId ? pathInFolder(currentDocumentId) ?? 'main.tex' : 'main.tex'),
    [currentDocumentId, pathInFolder]
  )

  const handleSend = useCallback(
    async (payload: PromptSubmitPayload) => {
      if (canChat) {
        setError(false)
        if (messages.length === 0 || selectionRanges?.some(range => !range.empty)) {
          // Include new selections in follow-ups as the user moves through the document.
          const context = [CONTEXT_MARKER]
          context.push(`Current path: ${currentPath}`)
          if (selectionRanges) {
            context.push(`Current selection: ${JSON.stringify(selectionRanges, null, 2)}`)
          }
          context.push('--- END CONTEXT')
          payload.text += '\n\n' + context.join('\n\n')
        }
        sendMessage(payload)
        sendMB('ai-chat', {
          type: 'message',
          action: 'send',
          characters: payload.text.length,
          files: payload.files?.length ?? 0,
          index: messages.length,
          chatId: id,
          position,
        })
      }
    },
    [canChat, messages.length, sendMessage, id, currentPath, selectionRanges, position]
  )

  const themeClass = classNames({ dark: overallTheme === 'dark' })
  const showUsageIndicator = useFeatureFlag('testing-ai-usage')

  return (
    <PromptInputProvider>
      <Conversation
        className={classNames(themeClass, {
          'workbench-conversation-streaming': status === 'streaming',
        })}
      >
        <ConversationContent>
          {!hasGivenAiConsent && hasAiFeatures ? (
            <WorkbenchConsent />
          ) : !hasAiFeatures || (hasGivenAiConsent && messages.length === 0) ? (
            <ConversationEmptyState
              hasSelection={!selectionEmpty}
              sendMessage={handleSend}
              setTab={setTab as (tab: WorkbenchTab) => void}
              disabled={!canChat}
            />
          ) : (
            messages.map((message: any) => (
              <div key={message.id}>
                <Message from={message.role}>
                  <MessageContent>
                    {message.parts.map((part: any, partIndex: number) => {
                      const key = `${message.role}-${partIndex}`
                      if (isTextPart(part)) {
                        // Keep editor context out of the displayed user message.
                        const text =
                          message.role === 'user'
                            ? part.text.split(CONTEXT_MARKER, 2)[0]
                            : part.text
                        return <Response markdown={text} key={key} />
                      }
                      if (isReasoningPart(part)) {
                        const isStreaming =
                          status === 'streaming' &&
                          partIndex === message.parts.length - 1 &&
                          message.id === messages.at(-1)?.id
                        return (
                          <Reasoning isStreaming={isStreaming} markdown={part.text} key={key} />
                        )
                      }
                      if (isFilePart(part)) {
                        return <FilePart part={part} key={key} />
                      }
                      if (isToolPart(part)) {
                        const toolName = getToolName(part)
                        const tool =
                          toolName in clientTools
                            ? clientTools[toolName]
                            : toolName in serverTools
                              ? serverTools[toolName]
                              : undefined
                        switch (part.state) {
                          case 'input-available':
                            return (
                              <Tool
                                defaultOpen={!!tool?.renderInput}
                                key={`${key}-${toolName}-${part.state}`}
                              >
                                <ToolHeader
                                  state={part.state}
                                  type={part.type}
                                  title={tool?.title?.(part) ?? part.title}
                                />
                                {tool?.renderInput !== undefined && (
                                  <ToolContent className="tool-use" key={key}>
                                    {tool.renderInput(part, { addToolOutput }, view)}
                                  </ToolContent>
                                )}
                              </Tool>
                            )
                          case 'output-available':
                            return (
                              <Tool
                                defaultOpen={!!tool?.renderOutput}
                                key={`${key}-${toolName}-${part.state}`}
                              >
                                <ToolHeader
                                  state={part.state}
                                  type={part.type}
                                  title={tool?.title?.(part)}
                                />
                                {tool?.renderOutput !== undefined && (
                                  <ToolContent className="tool-use">
                                    {tool.renderOutput(part, { addToolOutput }, view)}
                                  </ToolContent>
                                )}
                              </Tool>
                            )
                          default:
                            return (
                              <Tool key={key}>
                                <ToolHeader
                                  state={part.state}
                                  type={part.type}
                                  title={part.title}
                                />
                              </Tool>
                            )
                        }
                      }
                      return null
                    })}
                  </MessageContent>
                </Message>
              </div>
            ))
          )}
          {showAiFeaturesDisabled && <AiAssistantDisabled />}
        </ConversationContent>
        <ConversationScrollButton />
      </Conversation>
      {/* Provide quota feedback when the shared notice is hidden. */}
      {hasAiFeatures &&
        (getMeta('ol-showAiFeatures') ? (
          <AiPaywallNotification
            isActionBelowContent
            featureLocation="workbench"
          />
        ) : (
          !hasTokensLeft &&
          tokenResetDate > new Date() && <QuotaLimitNotification tokenResetDate={tokenResetDate} />
        ))}
      <div
        className={classNames('conversation-footer', themeClass)}
        // Prevent composer interaction while chat access is unavailable.
        {...(canChat ? {} : ({ inert: '' } as any))}
      >
        {(error || status === 'error') && error !== 'paywalled' && (
          <WorkbenchErrorNotification content={error as WorkbenchError} />
        )}
        <PromptInput
          status={status}
          onSend={handleSend}
          onStop={stop}
          setError={setError}
          currentPath={currentPath}
          editorSelectionRanges={selectionRanges}
          className={classNames({ 'disabled-state': !canChat })}
          ref={inputRef}
        />
        <div className="workbench-ai-message">
          <span>AI can make mistakes.</span>
          <span>Always check responses.</span>
          {showUsageIndicator && (
            <div className="mx-3 small premium-suggestion-indicator">
              {`you have ${suggestionsLeft} suggestions left`}
              {` you have ${tokensLeft} tokens remaining`}
            </div>
          )}
        </div>
      </div>
    </PromptInputProvider>
  )
}
