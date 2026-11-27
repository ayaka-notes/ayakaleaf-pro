import { v4 as uuid } from 'uuid'
import { login } from '../../../helpers/login'
import { postWithCsrf } from '../../../helpers/request'
import { ensureUserExists } from '../../../helpers/users'

// Without a mail server nobody could confirm a new email, so the module stays
// off. The other modes are the smtp/ and with-captcha/ variants.

describe('emails without a mail server', function () {
  const user = `no-smtp-${uuid()}@example.com`

  before(function () {
    ensureUserExists(user)
  })

  beforeEach(function () {
    login(user)
    cy.visit('/user/settings')
  })

  it('keeps the single email field', function () {
    cy.get('#email-input').should('have.value', user)
    cy.findByRole('heading', { name: 'Emails and affiliations' }).should(
      'not.exist'
    )
  })

  for (const route of ['secondary', 'default', 'delete']) {
    it(`has no /user/emails/${route} route`, function () {
      postWithCsrf(`/user/emails/${route}`, { email: user })
        .its('status')
        .should('equal', 404)
    })
  }
})
