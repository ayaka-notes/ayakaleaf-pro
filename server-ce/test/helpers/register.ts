import { createRateLimitWaiter } from './rateLimit'
import { postWithCsrf } from './request'

// POST /register allows 5 requests per minute per IP. Use 4, to leave room for
// requests this waiter does not count.
export const waitForRegisterSlot = createRateLimitWaiter(4, 60_000)

export function postRegister(body: Record<string, string>) {
  waitForRegisterSlot()
  cy.visit('/register')
  return postWithCsrf('/register', body).then(response => {
    if (response.status !== 429) return response
    // Requests from before this spec (e.g. the previous variant) used up the
    // window, wait for it to reset.
    cy.wait(61_000)
    return postWithCsrf('/register', body)
  })
}
