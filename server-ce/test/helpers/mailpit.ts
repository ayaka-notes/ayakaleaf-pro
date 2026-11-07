// The emails Overleaf sent through Mailpit (toolkit services/mailpit), for
// suites that point Overleaf's SMTP settings at it. Mailpit's Chaos makes the
// SMTP server refuse emails, like a mail server that is down.

const MAILPIT = 'http://mailpit:8025/api/v1'

type Message = { ID: string }

export function refuseEmails(refuse: boolean) {
  cy.request('PUT', `${MAILPIT}/chaos`, {
    Recipient: { ErrorCode: 451, Probability: refuse ? 100 : 0 },
  })
}

export function deleteEmails() {
  cy.request('DELETE', `${MAILPIT}/messages`)
}

export function emailsTo(email: string): Cypress.Chainable<Message[]> {
  return cy
    .request(`${MAILPIT}/search?query=${encodeURIComponent(`to:"${email}"`)}`)
    .its('body.messages')
}

// Retries until an email to the address arrived, answers its text
export function waitForEmail(
  email: string,
  attempts = 30
): Cypress.Chainable<string> {
  return emailsTo(email).then(messages => {
    if (messages.length > 0) {
      return cy.request(`${MAILPIT}/message/${messages[0].ID}`).its('body.Text')
    }
    expect(attempts, `email to ${email}`).to.be.greaterThan(0)
    cy.wait(500)
    return waitForEmail(email, attempts - 1)
  })
}

// The activation link of an email of Overleaf
export function activationLink(text: string) {
  return text.match(/\S*\/user\/activate\?token=\S+/)![0]
}

// The link of a password reset email of Overleaf
export function passwordResetLink(text: string) {
  return text.match(/\S*\/user\/password\/set\?passwordResetToken=\S+/)![0]
}
