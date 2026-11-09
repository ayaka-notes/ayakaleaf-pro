// Strong enough to pass the HaveIBeenPwned check that the suites enable.
export const DEFAULT_PASSWORD = 'e2e-Vq7#tLm2!xRp9'

const LETTERS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ'
const DIGITS = '0123456789'
// Accepted by core and not found in emails; no `{`, cy.type() reads it as a key
const SPECIALS = '#$%^&*()=[];:<>/?!,'

function randomChars(alphabet: string, length: number) {
  const values = crypto.getRandomValues(new Uint32Array(length))
  return Array.from(values, value => alphabet[value % alphabet.length]).join('')
}

// A password made when the test runs, so that the repo does not hold it. With
// 14 of its 30 characters never matching an email, core cannot find it too
// similar to one: the score stays at 0.69 at most, the limit is 0.7.
export function randomPassword() {
  return (
    randomChars(LETTERS, 8) +
    randomChars(SPECIALS, 14) +
    randomChars(LETTERS + DIGITS, 8)
  )
}

export function login(username: string, password = DEFAULT_PASSWORD) {
  cy.session(
    ['via-login', username, password],
    () => {
      cy.visit('/login')
      cy.get('input[name="email"]').type(username)
      cy.get('input[name="password"]').type(password)
      cy.findByRole('button', { name: 'Login' }).click()
      cy.url().should('contain', '/project')
    },
    {
      cacheAcrossSpecs: true,
      async validate() {
        // Hit a cheap endpoint that is behind AuthenticationController.requireLogin().
        cy.request({ url: '/user/personal_info', followRedirect: false }).then(
          response => {
            expect(response.status).to.equal(200)
          }
        )
      },
    }
  )
}

const activateRateLimitState = { count: 0, reset: 0 }

function handleActivateUserRateLimit() {
  cy.then(() => {
    activateRateLimitState.count++
    if (activateRateLimitState.reset < Date.now()) {
      activateRateLimitState.reset = Date.now() + 65_000
      activateRateLimitState.count = 1
    } else if (activateRateLimitState.count >= 6) {
      cy.wait(activateRateLimitState.reset - Date.now())
      activateRateLimitState.count = 1
    }
  })
}

export function activateUser(url: string, password = DEFAULT_PASSWORD) {
  handleActivateUserRateLimit()

  cy.session(url, () => {
    cy.visit(url)
    cy.url().then(url => {
      if (url.includes('/login')) return
      cy.url().should('contain', '/user/activate')
      cy.get('input[name="password"]').type(password)
      cy.findByRole('button', { name: 'Activate' }).click()
      cy.url().should('contain', '/project')
    })
  })
}
