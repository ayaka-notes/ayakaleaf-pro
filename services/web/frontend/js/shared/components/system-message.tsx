import Close from './close'
import usePersistedState from '../hooks/use-persisted-state'

type SystemMessageProps = {
  id: string
  children: React.ReactNode
  /**
   * #17d: unremovable messages have no dismiss (X) button and ignore the
   * per-user dismiss state (so admins can force the banner on everyone).
   */
  unremovable?: boolean
}

function SystemMessage({
  id,
  children,
  unremovable = false,
}: SystemMessageProps) {
  const [hidden, setHidden] = usePersistedState(
    `systemMessage.hide.${id}`,
    false
  )

  const dismissable = !unremovable && id !== 'protected'

  if (dismissable && hidden) {
    return null
  }

  return (
    <li className="system-message">
      {dismissable ? (
        <Close onDismiss={() => setHidden(true)} variant="dark" />
      ) : null}
      {children}
    </li>
  )
}

export default SystemMessage
