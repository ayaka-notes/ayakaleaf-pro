import {
  isSiteAdmin,
  resetAuthentikUsers,
  setAuthentikGroup,
  ssoLogin,
} from '../../../../../helpers/auth'

// Same deployment as the saml suite, restarted without the admin mapping:
// a login must keep whatever admin flag the account has.

before(function () {
  resetAuthentikUsers()
})

describe('SAML login without admin mapping', function () {
  it('keeps an admin an admin after leaving the Admins group', function () {
    setAuthentikGroup('alice', 'Admins', false)
    ssoLogin('/saml/login', 'alice')
    isSiteAdmin().should('equal', true)
    setAuthentikGroup('alice', 'Admins', true)
  })

  it('does not make a user an admin after joining the Admins group', function () {
    setAuthentikGroup('bob', 'Admins', true)
    ssoLogin('/saml/login', 'bob')
    isSiteAdmin().should('equal', false)
    setAuthentikGroup('bob', 'Admins', false)
  })
})
