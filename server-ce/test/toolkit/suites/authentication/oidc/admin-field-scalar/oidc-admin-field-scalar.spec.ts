import {
  isSiteAdmin,
  resetAuthentikUsers,
  ssoLogin,
} from '../../../../../helpers/auth'

// Same deployment as the oidc suite, restarted with the admin mapped from the
// single valued preferred_username claim (value alice). Runs after
// admin-field-email and leaves alice an admin and bob not again, as the
// following variants expect.

before(function () {
  resetAuthentikUsers()
})

describe('OIDC admin mapped from a single valued claim', function () {
  it('makes the user with the configured value an admin', function () {
    ssoLogin('/oidc/login', 'alice')
    isSiteAdmin().should('equal', true)
  })

  it('does not make other users admins', function () {
    // bob was made an admin by the email mapping before
    ssoLogin('/oidc/login', 'bob')
    isSiteAdmin().should('equal', false)
  })
})
