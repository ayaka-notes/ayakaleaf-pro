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
  // The settings page uses react-google-recaptcha with the enterprise script,
  // which it does not load when window.grecaptcha is already there
  cy.on('window:before:load', win => {
    let callback: (token: string) => void
    const widget = {
      render(el: unknown, options: { callback: typeof callback }) {
        callback = options.callback
        return 0
      },
      execute() {
        setTimeout(() => callback(token))
      },
      reset() {},
    }
    Object.assign(win, { grecaptcha: { ...widget, enterprise: widget } })
  })
}

export function resetRecaptchaMock() {
  cy.request('POST', `${MOCK}/reset`)
}

// The tokens Overleaf sent to siteverify since the last reset
export function verifiedTokens(): Cypress.Chainable<string[]> {
  return cy.request(`${MOCK}/verified`).its('body.tokens')
}
