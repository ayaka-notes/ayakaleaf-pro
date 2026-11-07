// Sends a request like the page's own scripts do, using the CSRF token of the
// current page.
export function requestWithCsrf(
  method: 'POST' | 'DELETE',
  url: string,
  body: Record<string, unknown> = {}
) {
  return cy
    .get('meta[name="ol-csrfToken"]')
    .invoke('attr', 'content')
    .then(csrfToken =>
      cy.request({
        method,
        url,
        body,
        headers: { 'X-Csrf-Token': csrfToken as string },
        failOnStatusCode: false,
        followRedirect: false,
      })
    )
}

export function postWithCsrf(url: string, body: Record<string, unknown>) {
  return requestWithCsrf('POST', url, body)
}
