// Service worker for browser push notifications (Web Push / VAPID).
//
// - `push`: decode the Apprise container's payload (JSON: {title, body,
//   url}) and show a notification. Clicking opens the URL.
// - `notificationclick`: focus the open tab or open a new one.
// - `notificationclick` on an expired subscription: the dispatch side
//   (Overleaf) treats a 404 from the push service as "subscription gone"
//   and the user re-enables on the settings page.

self.addEventListener('push', event => {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch {
    // Apprise sends JSON; a string payload (older setups) is the title.
    data = { title: 'Overleaf', body: event.data ? event.data.text() : '' }
  }

  event.waitUntil(
    self.registration.showNotification(data.title || 'Overleaf', {
      body: data.body || '',
      icon: '/images/favicon.png',
      data: { url: data.url || '/' },
    })
  )
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  const url = event.notification.data?.url || '/'
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      })
      for (const client of clients) {
        const candidateUrl =
          typeof client.url === 'string' ? client.url : ''
        if (candidateUrl.startsWith(new URL(url, self.location.origin).origin)) {
          if ('focus' in client) {
            await client.focus()
            return client
          }
        }
      }
      const opened = await self.clients.openWindow(url)
      return opened
    })()
  )
})

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim())
})
