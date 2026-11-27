import Notification from '@/shared/components/notification'

/*
 * Thin wrapper keeping the `notification-list` container class used by
 * settings widgets (spacings between stacked notifications), mirroring the
 * classic Overleaf OLNotification component.
 */
function OLNotification(props: React.ComponentProps<typeof Notification>) {
  return (
    <div className="notification-list">
      <Notification {...props} />
    </div>
  )
}

export default OLNotification
