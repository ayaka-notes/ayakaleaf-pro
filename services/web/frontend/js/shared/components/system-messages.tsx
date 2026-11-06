import { useEffect, useState } from 'react'
import SystemMessage from './system-message'
import TranslationMessage from './translation-message'
import useAsync from '../hooks/use-async'
import { getJSON } from '@/infrastructure/fetch-json'
import getMeta from '../../utils/meta'
import { SystemMessage as TSystemMessage } from '../../../../types/system-message'
import {
  detectMessageSurface,
  messageVisibleForSurface,
} from './system-message-surface'
import type { MessageSurface } from './system-message-surface'
import { debugConsole } from '@/utils/debugging'

// #17d: poll frequently enough that an admin-pushed emergency message
// appears without a page reload (no cross-page socket exists to push
// from); a 15 s interval plus a refocus refetch keeps it snappy.
const MESSAGE_POLL_INTERVAL = 15 * 1000

function SystemMessages() {
  const { data: messages, runAsync } = useAsync<TSystemMessage[]>()
  const suggestedLanguage = getMeta('ol-suggestedLanguage')

  // #17b: surface-scoped messages. SSR-safe: on the server (no window)
  // we default to the 'app' surface, where scoped messages are
  // conservatively hidden; the client re-renders with the real surface.
  const [surface] = useState<MessageSurface>(() =>
    typeof window === 'undefined'
      ? 'app'
      : detectMessageSurface(window.location.pathname)
  )

  useEffect(() => {
    const pollMessages = () => {
      // Ignore polling if tab is hidden or browser is offline
      if (document.hidden || !navigator.onLine) {
        return
      }

      runAsync(getJSON('/system/messages')).catch(debugConsole.error)
    }
    pollMessages()

    const interval = setInterval(pollMessages, MESSAGE_POLL_INTERVAL)

    // Refetch when the tab regains focus so a freshly published message
    // shows up promptly after the user returns to the editor.
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        pollMessages()
      }
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [runAsync])

  const visibleMessages =
    messages?.filter(
      m => m._id === 'protected' || messageVisibleForSurface(m, surface)
    ) ?? []

  if (!visibleMessages.length && !suggestedLanguage) {
    return null
  }

  return (
    <ul className="system-messages">
      {visibleMessages.map((message, idx) => (
        <SystemMessage
          key={idx}
          id={message._id}
          unremovable={message.unremovable === true}
        >
          {message.content}
        </SystemMessage>
      ))}
      {suggestedLanguage ? <TranslationMessage /> : null}
    </ul>
  )
}

export default SystemMessages
