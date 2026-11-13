import { waitForEmail } from './mailpit'
import { postWithCsrf } from './request'

// The extra emails of an account (module user-emails). The confirmation codes
// are read back from Mailpit, so the suite needs services/mailpit.

// The 6-digit code of a confirmation email of Overleaf
export function confirmationCode(text: string) {
  return text.match(/^\s*(\d{6})\s*$/m)![1]
}

export function emailRow(email: string) {
  return cy.contains('[data-testid="email-row"]', email)
}

// Adds a confirmed email to the logged in account, like the form on the
// settings page
export function addConfirmedEmail(email: string) {
  cy.visit('/user/settings')
  postWithCsrf('/user/emails/secondary', { email })
    .its('status')
    .should('equal', 200)
  waitForEmail(email).then(text =>
    postWithCsrf('/user/emails/confirm-secondary', {
      code: confirmationCode(text),
    })
      .its('status')
      .should('equal', 200)
  )
}

// Clicks through Make primary on the settings page
export function makePrimary(email: string) {
  cy.visit('/user/settings')
  emailRow(email).findByRole('button', { name: 'Make primary' }).click()
  cy.findByRole('dialog')
    .findByRole('button', { name: 'Change primary email' })
    .click()
}
