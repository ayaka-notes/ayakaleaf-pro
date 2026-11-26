import {
  idpEmail,
  resetAuthentikUsers,
  setAuthentikName,
  ssoLogin,
} from '../../../../../helpers/auth'
import { expectOwnAuditEntry } from '../../../../../helpers/auditLog'

// Same deployment as the saml suite, restarted with a first name attribute the
// IdP does not send: the login still writes the last name it does send.

before(function () {
  resetAuthentikUsers()
})

describe('SAML login without the first name attribute', function () {
  it('tells when a login changes only the last name', function () {
    ssoLogin('/saml/login', 'alice')
    setAuthentikName('alice', 'Alice Renamed')
    ssoLogin('/saml/login', 'alice')
    expectOwnAuditEntry(idpEmail('alice'), 'change-name')
      .its('info.lastName')
      .should('equal', 'Alice Renamed')
  })
})
