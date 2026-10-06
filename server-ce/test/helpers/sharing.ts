import { login } from './login'
import { postWithCsrf } from './request'

// Sharing a project the way users do, over the same HTTP calls as the share
// modal. Both functions start logged in as the owner and end logged in as the
// collaborator.

// Invites the user as the logged in owner, then accepts as that user through
// their notification.
export function shareProject(
  projectId: string,
  email: string,
  privileges: 'readOnly' | 'readAndWrite' | 'review'
) {
  cy.visit('/project')
  postWithCsrf(`/project/${projectId}/invite`, { email, privileges })
    .its('status')
    .should('equal', 200)
  login(email)
  cy.visit('/project')
  cy.request('/notifications').then(response => {
    const invite = response.body.find(
      (n: { messageOpts?: { projectId?: string } }) =>
        n.messageOpts?.projectId === projectId
    )
    postWithCsrf(
      `/project/${projectId}/invite/token/${invite.messageOpts.token}/accept`,
      {}
    )
      .its('status')
      .should('be.lessThan', 400)
  })
}

// Turns on link sharing as the logged in owner, then joins the project as the
// user through the view or the edit link.
export function shareProjectByLink(
  projectId: string,
  email: string,
  access: 'readOnly' | 'readAndWrite'
) {
  cy.visit('/project')
  postWithCsrf(`/project/${projectId}/settings/admin`, {
    publicAccessLevel: 'tokenBased',
  })
    .its('status')
    .should('be.lessThan', 400)
  cy.request(`/project/${projectId}/tokens`).then(response => {
    const token = response.body[access] as string
    login(email)
    cy.visit('/project')
    const grantUrl =
      access === 'readOnly' ? `/read/${token}/grant` : `/${token}/grant`
    postWithCsrf(grantUrl, { confirmedByUser: true })
      .its('body.redirect')
      .should('equal', `/project/${projectId}`)
  })
}
