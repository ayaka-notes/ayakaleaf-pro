import {
  isSiteAdmin,
  ldapLogin,
  resetAuthentikUsers,
  setAuthentikGroup,
} from '../../../../../helpers/auth'

// Same deployment as the ldap suite, restarted without the admin mapping:
// a login must keep whatever admin flag the account has.

before(function () {
  resetAuthentikUsers()
})

describe('LDAP login without admin mapping', function () {
  it('keeps an admin an admin after leaving the Admins group', function () {
    setAuthentikGroup('alice', 'Admins', false)
    ldapLogin('alice')
    cy.url().should('contain', '/project')
    isSiteAdmin().should('equal', true)
    setAuthentikGroup('alice', 'Admins', true)
  })

  it('does not make a user an admin after joining the Admins group', function () {
    setAuthentikGroup('bob', 'Admins', true)
    ldapLogin('bob')
    cy.url().should('contain', '/project')
    isSiteAdmin().should('equal', false)
    setAuthentikGroup('bob', 'Admins', false)
  })
})
