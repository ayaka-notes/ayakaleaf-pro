import { useState, useCallback, useEffect, useRef } from 'react'
import getMeta from '@/utils/meta'
import { getJSON, postJSON } from '@/infrastructure/fetch-json'
import {
    readSelectedModel,
    writeSelectedModel,
} from '../utils/llm-selected-model'
import { LLM_MODEL_CHANGED_EVENT } from './use-llm-model-selection'
// overleaf-lab (issue #119, owner-approved): browser-side chat history — the
// conversation survives refreshes and "New chat" becomes an archive instead of
// a wipe. IndexedDB-backed, per-project, capped, fail-safe.
import {
    clearProject,
    deriveConversationTitle,
    isAvailable,
    loadProject,
    makeConversationId,
    saveProject,
} from '../utils/llm-chat-storage'
import type { StoredConversation, StoredMessage } from '../utils/llm-chat-storage'

interface ConversationMeta {
    id: string
    title: string
    updatedAt: number
    count: number
}

interface Message {
    role: 'system' | 'user' | 'assistant'
    content: string
}

interface LLMModel {
    id: string
    name: string
    isDefault: boolean
    isPersonal?: boolean
    label?: string
    rowName?: string
}

interface LLMResponse {
    ok: boolean
    content?: string
    model?: string
    lane?: 'site' | 'user'
}

const SYSTEM_PROMPT = `You are an expert LaTeX debugging assistant and compiler error specialist.

**Your Primary Role - Error Debugging:**
- Analyze LaTeX compilation errors and warnings
- Identify syntax mistakes, missing packages, and structural issues
- Explain errors in beginner-friendly language
- Provide working fixes with clear explanations

**When a user sends a compilation error:**

1. **Quick Summary** (1-2 sentences)
   - What's wrong in plain English

2. **The Problem**
   - Explain the error clearly
   - Point to the exact issue in their code

3. **The Fix**
   - Show corrected code in \`\`\`latex blocks
   - Highlight what changed

4. **Why This Happened**
   - Brief explanation of the root cause
   - How to prevent it in future

**Error Analysis Guidelines:**
- The line marked with → is where the error occurred
- Look at surrounding context for clues
- Common issues: typos in commands, missing packages, unmatched braces
- Check for: \\begin without \\end, missing $, wrong package names

**Also Helpful With:**
- General LaTeX syntax and commands
- Document structure and formatting
- Mathematical typesetting
- Bibliography and citations

**Response Style:**
- Be concise and practical
- Use code blocks for all LaTeX examples
- Assume the user is learning LaTeX
- Focus on solving the immediate problem first

Remember: The user is likely frustrated. Be encouraging and clear!`

export const useLLMChat = () => {
    const projectId = getMeta('ol-project_id')

    const [messages, setMessages] = useState<Message[]>([
        {
            role: 'system',
            content: SYSTEM_PROMPT,
        },
    ])
    const [isLoading, setIsLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [models, setModels] = useState<LLMModel[]>([])
    const [selectedModel, setSelectedModel] = useState<string>('')
    const [lastUserMessage, setLastUserMessage] = useState<string>('')
    const [modelsLoaded, setModelsLoaded] = useState(false)
    const [modelsError, setModelsError] = useState(false)

    // overleaf-lab (issue #119): conversation history state. The full records
    // (with message bodies) live in storedRef — React state only holds small
    // metadata (the list UI never needs to diff megabytes of chat bodies).
    const storedRef = useRef<{
        conversations: StoredConversation[]
        activeId: string | null
    }>({ conversations: [], activeId: null })
    const activeConversationIdRef = useRef<string | null>(null)
    const [conversations, setConversations] = useState<ConversationMeta[]>([])
    const [activeConversationId, setActiveConversationId] = useState<string | null>(null)
    const [historyReady, setHistoryReady] = useState(false)

    const abortControllerRef = useRef<AbortController | null>(null)

    const messagesRef = useRef(messages)
    useEffect(() => {
        messagesRef.current = messages
    }, [messages])

    useEffect(() => {
        async function fetchModels() {
            if (!projectId) {
                // overleaf-lab: nothing to do outside a project; models list stays empty.
                return
            }
            try {
                const data = await getJSON<{
                    models: LLMModel[]
                    userRows?: Array<{ id: string; name: string; models: LLMModel[] }>
                }>(`/project/${projectId}/llm/models`)

                const { llmAllowUserSettings } = getMeta('ol-ExposedSettings') || {}
                const siteModels: LLMModel[] = data.models || []
                // overleaf-lab: BYO rows are namespaced u:<rowId>:<model>; the
                // backend returns them grouped per provider row. Flatten into the
                // picker list while keeping the row name for grouping in the UI.
                const rowModels: LLMModel[] = []
                if (llmAllowUserSettings !== false) {
                    for (const row of data.userRows || []) {
                        for (const m of row.models || []) {
                            rowModels.push({ ...m, rowName: row.name })
                        }
                    }
                }
                const modelsFromBackend = [...siteModels, ...rowModels]

                setModels(modelsFromBackend)
                setModelsError(false)

                const defaultModel =
                    modelsFromBackend.find((m: LLMModel) => m.isDefault) ||
                    modelsFromBackend[0]
                // overleaf-lab: restore the last selected model if it is still
                // available (remembers the choice and self-heals a stale/removed
                // id by falling back to the default). See utils/llm-selected-model.
                const stored = readSelectedModel(projectId)
                const restored =
                    stored && modelsFromBackend.some((m: LLMModel) => m.id === stored)
                        ? stored
                        : defaultModel?.id || ''
                setSelectedModel(restored)
                setModelsLoaded(true)
            } catch (err) {
                // overleaf-lab: surface the failure through the UI state below instead
                // of a raw console call (ESLint no-console).
                void err
                setModels([])
                setSelectedModel('')
                setModelsError(true)
                // Don't set modelsLoaded=true on error so button remains visible
            }
        }

        fetchModels()
    }, [projectId])

    // overleaf-lab (issue #119): derived list metadata for the UI (no bodies).
    const refreshMeta = useCallback((): void => {
        setConversations(
            storedRef.current.conversations
                .slice()
                .sort((a, b) => b.updatedAt - a.updatedAt)
                .map(c => ({
                    id: c.id,
                    title: c.title,
                    updatedAt: c.updatedAt,
                    count: c.messages.length,
                })),
        )
    }, [])

    // overleaf-lab (issue #119): write the finished conversation back to
    // IndexedDB. Creates the conversation lazily on its first persisted pair
    // (so "New chat" never creates empty rows).
    const persistActiveConversation = useCallback(
        async (all: Message[]): Promise<void> => {
            if (!projectId) return
            const msgs: StoredMessage[] = all
                .filter(m => m.role === 'user' || m.role === 'assistant')
                .map(m => ({ role: m.role, content: m.content }))
            if (!msgs.length) return
            let convId = activeConversationIdRef.current
            let list = storedRef.current.conversations.slice()
            let idx = convId ? list.findIndex(c => c.id === convId) : -1
            if (idx === -1) {
                convId = makeConversationId()
                list = [
                    {
                        id: convId,
                        title: deriveConversationTitle(msgs),
                        updatedAt: Date.now(),
                        messages: msgs,
                    },
                    ...list,
                ]
                setActiveConversationId(convId)
            }
            else {
                list = list.map((c, i) =>
                    i === idx
                        ? { ...c, updatedAt: Date.now(), messages: msgs }
                        : c,
                )
            }
            activeConversationIdRef.current = convId
            storedRef.current = { conversations: list, activeId: convId }
            refreshMeta()
            await saveProject({
                projectId,
                activeId: convId,
                conversations: list,
            })
        },
        [projectId, refreshMeta],
    )


    // overleaf-lab: persist the selected model so the selection toolbar ("Ask AI")
    // can reuse it. Runs for the initial default and every user change.
    useEffect(() => {
        // overleaf-lab: selection is remembered per project (falls back to the
        // global key outside project contexts).
        writeSelectedModel(selectedModel, projectId)
    }, [selectedModel, projectId])

    // overleaf-lab (owner request 2026-08-25): the "Select LLM Model" dialog
    // (and any other AI surface) can change the shared selection — keep the
    // chat's working model (sent with every request) in sync.
    useEffect(() => {
        const handler = (e: Event) => {
            const value = (e as CustomEvent).detail?.value
            if (typeof value === 'string') setSelectedModel(value)
        }
        window.addEventListener(LLM_MODEL_CHANGED_EVENT, handler)
        return () => window.removeEventListener(LLM_MODEL_CHANGED_EVENT, handler)
    }, [])

    const sendMessage = useCallback(
        async (userMessage: string, baseMessages?: Message[]) => {
            const newMessages: Message[] = [
                ...(baseMessages || messagesRef.current),
                { role: 'user', content: userMessage },
            ]

            // F11: keep the ref in sync immediately so callers that raced a
            // setMessages (e.g. rerunLastMessage) can never observe a stale list.
            messagesRef.current = newMessages
            setMessages(newMessages)
            setIsLoading(true)
            setError(null)
            setLastUserMessage(userMessage)

            abortControllerRef.current = new AbortController()

            try {
                // overleaf-lab: swallowAbortError=false so a Stop press REJECTS the
                // request with AbortError (the default would leave it pending and
                // the UI would hang on "loading").
                const data: LLMResponse = await postJSON('/project/' + projectId + '/llm/chat', {
                    body: {
                        // overleaf-lab (2026-08-26): no explicit model — the
                        // backend resolves the user's profile selection, so
                        // chat, ask-AI, review, generators and compile-fix all
                        // run on exactly the user's chosen model.
                        messages: newMessages,
                    },
                    signal: abortControllerRef.current.signal,
                    swallowAbortError: false,
                })

                if (!data || typeof data.content !== 'string') {
                    throw new Error((data && data.message) || 'Invalid response format from LLM API')
                }

                const assistantMessage: Message = {
                    role: 'assistant',
                    content: data.content,
                }

                setMessages([...newMessages, assistantMessage])
                // overleaf-lab (issue #119): persist the finished exchange —
                // user message AND reply — into the active conversation.
                void persistActiveConversation([...newMessages, assistantMessage])
            } catch (err: any) {
                if (err.name === 'AbortError') {
                    const abortMsg: Message = {
                        role: 'assistant',
                        content: 'Request stopped by user.',
                    }
                    setMessages([...newMessages, abortMsg])
                    void persistActiveConversation([...newMessages, abortMsg])
                } else {
                    const errorMessage =
                        err?.data?.message ||
                        (err instanceof Error ? err.message : 'Unknown error')
                    setError(errorMessage)

                    const errorMsg: Message = {
                        role: 'assistant',
                        content: `Error: ${errorMessage}\n\nPlease check the console for details.`,
                    }
                    setMessages([...newMessages, errorMsg])
                    void persistActiveConversation([...newMessages, errorMsg])
                }
            } finally {
                setIsLoading(false)
                abortControllerRef.current = null
            }
        },
        [projectId, persistActiveConversation]
    )

    const stopGeneration = useCallback(() => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort()
        }
    }, [])

    const rerunLastMessage = useCallback(() => {
        if (!lastUserMessage) return

        const currentMessages = messagesRef.current
        let foundIndex = -1

        for (let i = currentMessages.length - 1; i >= 0; i--) {
            if (
                currentMessages[i].role === 'user' &&
                currentMessages[i].content === lastUserMessage
            ) {
                foundIndex = i
                break
            }
        }

        if (foundIndex === -1) {
            sendMessage(lastUserMessage)
            return
        }

        const messagesBeforeRerun = currentMessages.slice(0, foundIndex)
        setMessages(messagesBeforeRerun)

        // F11: pass the exact message base explicitly so the 50 ms gap cannot
        // observe a stale ref (previously a race window in effect timing).
        setTimeout(() => {
            sendMessage(lastUserMessage, messagesBeforeRerun)
        }, 50)
    }, [lastUserMessage, sendMessage])

    // overleaf-lab (issue #119): "New chat" now ARCHIVES the current
    // conversation (it stays findable in the history list) instead of wiping.
    const newConversation = useCallback((): void => {
        activeConversationIdRef.current = null
        storedRef.current.activeId = null
        setActiveConversationId(null)
        setMessages([
            {
                role: 'system',
                content: SYSTEM_PROMPT,
            },
        ])
        setError(null)
        setLastUserMessage('')
    }, [])

    // Back-compat alias: older callers / the pane's clear button expect this.
    const clearMessages = useCallback((): void => {
        newConversation()
    }, [newConversation])

    // overleaf-lab (issue #119): switch the pane to a stored conversation.
    const switchConversation = useCallback(
        (id: string): void => {
            const conv = storedRef.current.conversations.find(c => c.id === id)
            if (!conv) return
            storedRef.current.activeId = id
            activeConversationIdRef.current = id
            setActiveConversationId(id)
            setMessages([
                { role: 'system', content: SYSTEM_PROMPT },
                ...conv.messages
                    .filter(m => m.role === 'user' || m.role === 'assistant')
                    .map(m => ({ role: m.role, content: m.content })),
            ])
            setError(null)
            const lastUser = [...conv.messages]
                .reverse()
                .find(m => m.role === 'user')
            setLastUserMessage(lastUser ? lastUser.content : '')
            if (projectId) {
                void saveProject({
                    projectId,
                    activeId: id,
                    conversations: storedRef.current.conversations,
                })
            }
        },
        [projectId],
    )

    // overleaf-lab (issue #119): delete one conversation (+ reset the pane if
    // it is the active one).
    const deleteConversation = useCallback(
        (id: string): void => {
            storedRef.current.conversations = storedRef.current.conversations.filter(
                c => c.id !== id,
            )
            if (activeConversationIdRef.current === id) {
                activeConversationIdRef.current = null
                storedRef.current.activeId = null
                setActiveConversationId(null)
                setMessages([{ role: 'system', content: SYSTEM_PROMPT }])
                setError(null)
                setLastUserMessage('')
            }
            refreshMeta()
            if (projectId) {
                void saveProject({
                    projectId,
                    activeId: activeConversationIdRef.current,
                    conversations: storedRef.current.conversations,
                })
            }
        },
        [projectId, refreshMeta],
    )

    // overleaf-lab (issue #119): wipe every stored conversation for the project
    // (the browser only — nothing ever went to the server).
    const clearAllHistory = useCallback(
        async (): Promise<void> => {
            storedRef.current = { conversations: [], activeId: null }
            activeConversationIdRef.current = null
            setConversations([])
            setActiveConversationId(null)
            setMessages([{ role: 'system', content: SYSTEM_PROMPT }])
            setError(null)
            setLastUserMessage('')
            if (projectId) await clearProject(projectId)
        },
        [projectId],
    )

    // overleaf-lab (issue #119): export the current conversation as Markdown
    // (bridges the "browser storage is device-bound" gap).
    const exportConversation = useCallback((): void => {
        const msgs = messagesRef.current
            .filter(m => m.role === 'user' || m.role === 'assistant')
        if (!msgs.length) return
        const title = deriveConversationTitle(
            msgs.map(m => ({ role: m.role, content: m.content })),
        )
        const lines: string[] = [
            `# ${title}`,
            '',
            `> Exported from the Overleaf AI Assistant — ${new Date().toISOString()}`,
            '',
        ]
        for (const m of msgs) {
            lines.push(`**${m.role === 'user' ? 'You' : 'Assistant'}:**`, '', m.content, '', '---', '')
        }
        const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `ai-chat-${(projectId || 'export').slice(-8)}-${new Date().toISOString().slice(0, 10)}.md`
        document.body.appendChild(a)
        a.click()
        a.remove()
        setTimeout(() => URL.revokeObjectURL(url), 5000)
    }, [projectId])

    // overleaf-lab (issue #119): hydrate the project's stored conversations on
    // mount. The ACTIVE conversation is restored into the pane so a page
    // refresh no longer loses the thread; otherwise an empty (new) state.
    useEffect(() => {
        if (!projectId) {
            setHistoryReady(true)
            return
        }
        if (!isAvailable()) {
            // IndexedDB blocked (private mode etc.) — behave as before.
            setHistoryReady(true)
            return
        }
        let cancelled = false
        void loadProject(projectId).then(stored => {
            if (cancelled) return
            let activeId: string | null = null
            let active: StoredConversation | null = null
            if (stored) {
                storedRef.current = {
                    conversations: stored.conversations,
                    activeId: null,
                }
                const candidate = stored.activeId
                    ? stored.conversations.find(c => c.id === stored.activeId)
                    : stored.conversations[0] || null
                active = candidate || null
                if (active) {
                    activeId = active.id
                    storedRef.current.activeId = activeId
                    activeConversationIdRef.current = activeId
                    setActiveConversationId(activeId)
                    const body = active.messages.filter(
                        m => m.role === 'user' || m.role === 'assistant',
                    )
                    if (body.length) {
                        setMessages([
                            { role: 'system', content: SYSTEM_PROMPT },
                            ...body.map(m => ({ role: m.role, content: m.content })),
                        ])
                        const lastUser = [...body].reverse().find(m => m.role === 'user')
                        if (lastUser) setLastUserMessage(lastUser.content)
                    }
                }
            }
            refreshMeta()
            setHistoryReady(true)
        })
        return () => {
            cancelled = true
        }
    }, [projectId, refreshMeta])

    // Listen for messages from error log "Ask AI" buttons
    useEffect(() => {
        const handleSendMessage = (event: CustomEvent<{ message: string }>) => {
            sendMessage(event.detail.message)
        }

        window.addEventListener(
            'llm-chat-send-message',
            handleSendMessage as EventListener
        )

        return () => {
            window.removeEventListener(
                'llm-chat-send-message',
                handleSendMessage as EventListener
            )
        }
    }, [sendMessage])

    return {
        messages,
        isLoading,
        error,
        sendMessage,
        stopGeneration,
        rerunLastMessage,
        clearMessages,
        models,
        selectedModel,
        setSelectedModel,
        canRerun: !!lastUserMessage,
        modelsLoaded,
        modelsError,
        hasModels: models.length > 0,
        // overleaf-lab (issue #119): conversation history API.
        conversations,
        activeConversationId,
        historyReady,
        newConversation,
        switchConversation,
        deleteConversation,
        clearAllHistory,
        exportConversation,
    }
}
