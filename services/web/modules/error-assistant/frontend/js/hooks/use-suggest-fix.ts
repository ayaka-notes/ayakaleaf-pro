import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import getMeta from '@/utils/meta'
import { debugConsole } from '@/utils/debugging'

/**
 * Requests a fix for one compile error and consumes the streamed SSE response.
 * Text events update the explanation; tool events update progress and collect
 * suggested changes for review. Finish and error events update request state.
 */

export type SuggestFixLogEntry = {
  file?: string
  line?: number
  column?: number
  raw?: string
  ruleId?: string
  level?: string
}

export type Suggestion = {
  path?: string
  from: { line: number; content: string }
  to: { content: string }
}

export type AssistantMessage = {
  role: 'assistant'
  content: string
  // A fix can contain suggestions for several separate line ranges.
  suggestions: Suggestion[]
}

// Remove log boilerplate to keep the request focused on the reported error.
function cleanRaw(raw: string): string {
  return (
    raw
      .trim()
      .replace(/(\n|^)\[\d.*/s, '')
      .replace(/\s\*{11}\s.*/s, '')
      .replace(/(\n|^)See the LaTeX manual .+/, '')
      .replace(/(\n|^)Type\s+H <return> .+/, '') || raw
  )
}

export function useSuggestFix(logEntry: SuggestFixLogEntry) {
  const { t } = useTranslation()
  const [messages, setMessages] = useState<AssistantMessage[]>([])
  const [heading, setHeading] = useState('')
  const [running, setRunning] = useState(false)
  const [finished, setFinished] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rating, setRating] = useState(0)
  const abortRef = useRef<AbortController | null>(null)

  const suggestFix = useCallback(async () => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setError(null)
    setFinished(false)
    setRunning(true)
    setHeading(t('finding_a_fix'))

    const assistant: AssistantMessage = {
      role: 'assistant',
      content: '',
      suggestions: [],
    }
    const push = () =>
      setMessages([{ ...assistant, suggestions: [...assistant.suggestions] }])
    push()

    const projectId = getMeta('ol-project_id')
    try {
      const response = await fetch(`/project/${projectId}/suggest-fix`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Csrf-Token': getMeta('ol-csrfToken'),
        },
        body: JSON.stringify({
          logEntry: {
            file: logEntry.file,
            line: logEntry.line,
            column: logEntry.column,
            raw: cleanRaw(String(logEntry.raw || '')),
            ruleId: logEntry.ruleId,
            level: logEntry.level,
          },
          outputFiles: [],
        }),
        signal: controller.signal,
      })
      if (abortRef.current !== controller) return

      if (response.status === 429) {
        setError('paywalled')
        return
      }
      if (!response.ok || !response.body) {
        setError('unhandled')
        return
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (abortRef.current !== controller) return
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const frames = buffer.split('\n\n')
        buffer = frames.pop() ?? ''
        for (const frame of frames) {
          const line = frame.trim()
          if (!line.startsWith('data:')) continue
          let evt: any
          try {
            evt = JSON.parse(line.slice(5).trim())
          } catch {
            continue
          }
          if (evt.delta) {
            assistant.content += evt.delta
            push()
          } else if (evt.finish) {
            setHeading('')
          } else if (evt.error) {
            setError('unhandled')
          } else if (evt.tool) {
            const path = evt.args?.path?.replace(/^\.\//, '')
            switch (evt.tool) {
              case 'getDocLines':
                setHeading(t('read_lines_from_path', { path }))
                break
              case 'searchDocLines':
                setHeading(
                  t('searched_path_for_lines_containing', {
                    path,
                    query: evt.args?.query,
                  })
                )
                break
              case 'suggestLineChange':
                setHeading(
                  t('suggested_fix_for_error_in_path', {
                    path: path ?? logEntry.file,
                  })
                )
                // Keep each changed range as a separate suggestion for review.
                assistant.suggestions.push(evt.args)
                assistant.content += '\n\n'
                push()
                break
              default:
                break
            }
          }
        }
      }
      setFinished(true)
    } catch (err: any) {
      if (abortRef.current === controller && err?.name !== 'AbortError') {
        debugConsole.error(err)
        setError('unhandled')
      }
    } finally {
      if (abortRef.current === controller) {
        setHeading('')
        setRunning(false)
      }
    }
  }, [logEntry, t])

  return {
    messages,
    heading,
    running,
    finished,
    error,
    rating,
    setRating,
    suggestFix,
  }
}
