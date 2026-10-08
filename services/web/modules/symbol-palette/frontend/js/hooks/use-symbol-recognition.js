import { useCallback, useEffect, useRef, useState } from 'react'

export default function useSymbolRecognition() {
  const [status, setStatus] = useState('loading')
  const [attempt, setAttempt] = useState(0)
  const clientRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    let client
    setStatus('loading')
    async function initialize() {
      try {
        const { default: createRecognizer } =
          await import('../recognition/create-recognizer')
        if (cancelled) return
        client = createRecognizer()
        clientRef.current = client
        await client.init()
        if (!cancelled) setStatus('ready')
      } catch (error) {
        if (cancelled) return
        client?.destroy()
        console.error('[symbol-recognition] Failed to load recognizer', error)
        setStatus('error')
      }
    }
    initialize()
    return () => {
      cancelled = true
      clientRef.current = null
      client?.destroy()
    }
  }, [attempt])

  const recognize = useCallback(async strokes => {
    const client = clientRef.current
    try {
      return await client.recognize(strokes)
    } catch (error) {
      if (clientRef.current === client) {
        console.error('[symbol-recognition] Inference failed', error)
        setStatus('error')
      }
      return []
    }
  }, [])

  const retry = useCallback(() => setAttempt(value => value + 1), [])
  return { status, recognize, retry }
}
