/**
 * Asks the server for a fix of one log entry and follows the streamed answer.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import getMeta from '@/utils/meta'
import { debugConsole } from '@/utils/debugging'

export type FixEntry = {
  file?: string
  line?: number
  column?: number
  level?: string
  ruleId?: string
  raw?: string
}

export type Fix = { path: string; startLine: number; oldText: string; newText: string }

export type FixStatus = 'idle' | 'running' | 'done' | 'failed' | 'quota'

// TeX's help text after an error adds nothing for the model
const MAX_LOG_LINES = 15
const MAX_LOG_CHARS = 1500

function shortenLog(raw = '') {
  return raw.trim().split('\n').slice(0, MAX_LOG_LINES).join('\n').slice(0, MAX_LOG_CHARS)
}

export function useFixRequest(entry: FixEntry) {
  const [explanation, setExplanation] = useState('')
  const [fixes, setFixes] = useState<Fix[]>([])
  const [status, setStatus] = useState<FixStatus>('idle')
  const current = useRef<AbortController | null>(null)

  useEffect(() => () => current.current?.abort(), [])

  const request = useCallback(async () => {
    current.current?.abort()
    const controller = new AbortController()
    current.current = controller
    const stillCurrent = () => current.current === controller
    setExplanation('')
    setFixes([])
    setStatus('running')

    let outcome: FixStatus = 'failed'
    try {
      const response = await fetch(`/project/${getMeta('ol-project_id')}/ai/fix-error`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Csrf-Token': getMeta('ol-csrfToken'),
        },
        body: JSON.stringify({
          entry: {
            file: entry.file,
            line: entry.line,
            column: entry.column,
            level: entry.level,
            ruleId: entry.ruleId,
            raw: shortenLog(entry.raw),
          },
        }),
        signal: controller.signal,
      })
      if (response.status === 429) {
        outcome = 'quota'
        return
      }
      if (!response.ok || !response.body) return

      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
      let pending = ''
      for (;;) {
        const { value, done } = await reader.read()
        if (done || !stillCurrent()) break
        pending += value
        const lines = pending.split('\n')
        pending = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.trim()) continue
          const event = JSON.parse(line)
          if (event.type === 'text') setExplanation(text => text + event.text)
          else if (event.type === 'fix') setFixes(list => [...list, event.fix])
          else if (event.type === 'done') outcome = 'done'
        }
      }
    } catch (error) {
      if ((error as Error).name !== 'AbortError') debugConsole.error(error)
    } finally {
      if (stillCurrent()) setStatus(outcome)
    }
  }, [entry])

  return { explanation, fixes, status, request }
}
