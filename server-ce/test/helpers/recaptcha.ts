// reCAPTCHA for the suites that turn it on with RECAPTCHA_SITE_KEY. The pages
// load the widget from www.recaptcha.net, here a stand-in whose execute()
// answers the given token right away. Overleaf checks it against
// services/recaptcha-mock, which passes only `e2e-pass`.

const MOCK = 'http://recaptcha-mock:8080/_mock'

export function stubRecaptcha(token = 'e2e-pass') {
  cy.intercept('https://www.recaptcha.net/recaptcha/api.js*', {
    headers: { 'Content-Type': 'application/javascript' },
    body: `
      window.grecaptcha = {
        render: function (el, options) {
          window.e2eRecaptcha = options
          return 0
        },
        execute: function () {
          setTimeout(function () {
            window.e2eRecaptcha.callback(${JSON.stringify(token)})
          })
          return Promise.resolve()
        },
        reset: function () {},
      }
    `,
  })
}

export function resetRecaptchaMock() {
  cy.request('POST', `${MOCK}/reset`)
}

// The tokens Overleaf sent to siteverify since the last reset
export function verifiedTokens(): Cypress.Chainable<string[]> {
  return cy.request(`${MOCK}/verified`).its('body.tokens')
}
