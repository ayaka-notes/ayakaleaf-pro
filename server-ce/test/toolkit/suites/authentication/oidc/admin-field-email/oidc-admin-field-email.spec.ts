import {
  isSiteAdmin,
  resetAuthentikUsers,
  ssoLogin,
} from '../../../../../helpers/auth'

// Same deployment as the oidc suite, restarted with the admin mapped from the
// email claim (OVERLEAF_OIDC_IS_ADMIN_FIELD=email, value bob@ayakaleaf.test).
// Leaves bob an admin and alice not, admin-field-scalar runs next.

before(function () {
  resetAuthentikUsers()
})

describe('OIDC admin mapped from the email claim', function () {
  it('makes the configured address an admin', function () {
    ssoLogin('/oidc/login', 'bob')
    isSiteAdmin().should('equal', true)
  })

  it('does not use the groups claim any more', function () {
    // alice is in the Admins group, but her email is not the configured one
    ssoLogin('/oidc/login', 'alice')
    isSiteAdmin().should('equal', false)
  })
})
