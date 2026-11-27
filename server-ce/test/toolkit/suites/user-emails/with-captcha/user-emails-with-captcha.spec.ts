import { v4 as uuid } from 'uuid'
import { login } from '../../../../helpers/login'
import { waitForEmail } from '../../../../helpers/mailpit'
import {
  resetRecaptchaMock,
  stubRecaptcha,
  verifiedTokens,
} from '../../../../helpers/recaptcha'
import { postWithCsrf } from '../../../../helpers/request'
import { confirmationCode, emailRow } from '../../../../helpers/userEmails'
import { ensureUserExists } from '../../../../helpers/users'

// Same deployment as the smtp variant, restarted with RECAPTCHA_SITE_KEY:
// adding an email needs a captcha, checked against services/recaptcha-mock.

const ROBOT_ERROR = /could not verify that you are not a robot/
const user = `emails-captcha-${uuid()}@example.com`
const address = (name: string) => `emails-${uuid()}-${name}@example.com`

function submitAddEmailForm(email: string) {
  cy.visit('/user/settings')
  cy.findByRole('button', { name: 'Add another email' }).click()
  cy.findByTestId('affiliations-email').type(email)
  cy.findByRole('button', { name: 'Add new email' }).click()
}

before(function () {
  stubRecaptcha()
  ensureUserExists(user)
})

beforeEach(function () {
  // The login goes through /login too
  stubRecaptcha()
  login(user)
  resetRecaptchaMock()
})

describe('adding an email with a captcha', function () {
  it('adds the email when the captcha passes', function () {
    const added = address('pass')
    submitAddEmailForm(added)
    waitForEmail(added).then(text => {
      cy.get('#one-time-code').type(confirmationCode(text))
      cy.findByRole('button', { name: 'Confirm' }).click()
    })
    emailRow(added).should('not.contain', 'Unconfirmed')
    verifiedTokens().should('deep.equal', ['e2e-pass'])
  })

  it('refuses the email when the captcha fails', function () {
    stubRecaptcha('e2e-fail')
    submitAddEmailForm(address('fail'))
    cy.contains(ROBOT_ERROR)
    verifiedTokens().should('include', 'e2e-fail')
  })

  it('refuses a request without a captcha', function () {
    cy.visit('/user/settings')
    postWithCsrf('/user/emails/secondary', { email: address('none') }).then(
      response => {
        expect(response.status).to.equal(400)
        expect(response.body.errorReason).to.equal(
          'cannot_verify_user_not_robot'
        )
      }
    )
  })
})
