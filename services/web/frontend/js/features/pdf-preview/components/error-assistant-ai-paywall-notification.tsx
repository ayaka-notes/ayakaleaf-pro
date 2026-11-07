import { useCallback, useEffect, useState } from 'react'
import AiPaywallNotification from '@/shared/components/ai-paywall-notification'
import { useDetachCompileContext as useCompileContext } from '@/shared/context/detach-compile-context'
import useEventListener from '@/shared/hooks/use-event-listener'

export default function ErrorAssistantAiPaywallNotification() {
  const { showLogs } = useCompileContext()
  const [hasTriggered, setHasTriggered] = useState(false)

  useEventListener(
    'aiAssist:showPaywall',
    useCallback((event: CustomEvent<{ origin?: string }>) => {
      if (event.detail?.origin === 'suggest-fix') {
        setHasTriggered(true)
      }
    }, [])
  )

  useEffect(() => {
    if (!showLogs) {
      setHasTriggered(false)
    }
  }, [showLogs])

  if (!hasTriggered) {
    return null
  }

  return <AiPaywallNotification featureLocation="errorAssist" />
}
