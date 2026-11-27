// A stand-in for Google reCAPTCHA's siteverify API
// (https://www.google.com/recaptcha/api/siteverify), which CaptchaMiddleware
// calls with the secret key and the token of the widget. The token
// `e2e-pass` passes, anything else fails like an invalid token.
//
// Port 443 serves www.google.com over TLS, see services/lib/mock-server.mjs.
// Port 8080 is the control API for the tests
// (http://recaptcha-mock:8080/_mock/...): reset and list the verified tokens.

import { listen, send } from './lib/mock-server.mjs'

const SECRET = process.env.RECAPTCHA_MOCK_SECRET

let verified

function reset() {
  verified = []
}
reset()

// https://developers.google.com/recaptcha/docs/verify#api_request
const google = [
  [
    'POST',
    /^\/recaptcha\/api\/siteverify$/,
    ({ res, body }) => {
      verified.push(body.response)
      const errors = []
      if (body.secret !== SECRET) errors.push('invalid-input-secret')
      if (body.response !== 'e2e-pass') errors.push('invalid-input-response')
      if (errors.length > 0) {
        return send(res, 200, { success: false, 'error-codes': errors })
      }
      send(res, 200, {
        success: true,
        challenge_ts: new Date().toISOString(),
        hostname: 'sharelatex',
      })
    },
  ],
]

const control = [
  [
    'POST',
    /^\/_mock\/reset$/,
    ({ res }) => {
      reset()
      send(res, 204)
    },
  ],
  // The tokens Overleaf sent to siteverify, in order
  [
    'GET',
    /^\/_mock\/verified$/,
    ({ res }) => {
      send(res, 200, { tokens: verified })
    },
  ],
]

listen({ name: 'recaptcha mock', routes: google, control })
