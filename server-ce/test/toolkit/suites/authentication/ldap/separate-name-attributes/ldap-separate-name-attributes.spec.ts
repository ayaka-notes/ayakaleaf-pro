import {
  currentUser,
  ldapLogin,
  resetAuthentikUsers,
  setAuthentikAttributes,
} from '../../../../../helpers/auth'

// Same deployment as the ldap suite, restarted with the first and last name
// taken from their own attributes instead of splitting the full name.

before(function () {
  resetAuthentikUsers()
})

describe('LDAP login with first and last name attributes', function () {
  it('takes the first value of a name attribute with several values', function () {
    setAuthentikAttributes('bob', { givenName: ['Bob', 'Bobby'], sn: 'User' })
    ldapLogin('bob')
    cy.url().should('contain', '/project')
    currentUser().then(user => {
      expect([user.first_name, user.last_name]).to.deep.equal(['Bob', 'User'])
    })
    setAuthentikAttributes('bob', {})
  })
})
