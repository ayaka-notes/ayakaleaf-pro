import { adminUserInfo } from './adminTools'

// The newest entry of this operation on the user's audit log, as the admin
// panel lists it, after checking that the user is the initiator: what the
// account did itself, or what its SSO login did to it. Expects to be logged in
// as admin.
export function expectOwnAuditEntry(email: string, operation: string) {
  const query = new URLSearchParams({ operation, pageSize: '200' })
  return adminUserInfo(email)
    .then(user =>
      cy.request(`/admin/user/${user.id}/audit-log/list?${query}`).its('body.entries')
    )
    .then((entries: { initiatorEmail?: string }[]) => {
      expect(entries, operation).to.have.length.at.least(1)
      expect(entries[0].initiatorEmail, operation).to.equal(email)
      return entries[0]
    })
}

// The newest entry of this operation on the project's audit log, naming the
// initiator. Polls: a project's entry may be written in the background.
export function expectProjectAuditEntry(
  projectId: string,
  operation: string,
  initiator: string,
  attempt = 1
): Cypress.Chainable<{ initiatorEmail?: string; info?: object }> {
  const query = new URLSearchParams({ operation, pageSize: '200' })
  return cy
    .request(`/admin/project/${projectId}/audit-log/list?${query}`)
    .its('body.entries')
    .then((entries: { initiatorEmail?: string }[]) => {
      if (entries.length === 0 && attempt < 10) {
        cy.wait(500)
        return expectProjectAuditEntry(projectId, operation, initiator, attempt + 1)
      }
      expect(entries, operation).to.have.length.at.least(1)
      expect(entries[0].initiatorEmail, operation).to.equal(initiator)
      return entries[0]
    })
}
