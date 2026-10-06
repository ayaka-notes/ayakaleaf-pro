// Returns a function to call before each request to an endpoint that allows
// `points` requests per `durationMs`. It waits for the next window when the
// budget is used up, so a suite can send more requests than the limit allows.
export function createRateLimitWaiter(points: number, durationMs: number) {
  let windowStart = 0
  let used = 0
  return function waitForSlot() {
    cy.then(() => {
      if (Date.now() - windowStart > durationMs) {
        windowStart = Date.now()
        used = 0
      }
      if (used >= points) {
        cy.log('Wait for the rate limit window to reset')
        // Small margin, the server starts its window a bit after us.
        cy.wait(windowStart + durationMs + 2_000 - Date.now())
        cy.then(() => {
          windowStart = Date.now()
          used = 0
        })
      }
      cy.then(() => {
        used++
      })
    })
  }
}

