import { v4 as uuid } from 'uuid'
import { randomPassword } from '../../../../helpers/login'
import { inviteLink, waitForEmail } from '../../../../helpers/mailpit'
import {
  expectInviteSignUp,
  openInviteSignedOut,
  signUpThroughInvite,
} from '../../../../helpers/register'
import { ensureUserExists } from '../../../../helpers/users'

// login-register module with OVERLEAF_ALLOW_PUBLIC_REGISTRATION=invite@*: the
// invite of any user lets the invited address sign up, so a guest who signed
// up that way can let the next one in.

describe('sign up through the invite of any user', function () {
  it('lets a guest who signed up through an invite invite the next one', function () {
    const owner = `owner-${uuid()}@example.org`
    const guest = `guest-${uuid()}@example.net`
    const password = randomPassword()
    const next = `next-${uuid()}@example.net`
    ensureUserExists(owner)
    openInviteSignedOut(guest, owner)
    waitForEmail(guest).then(text => {
      signUpThroughInvite(inviteLink(text), guest, password)
    })
    openInviteSignedOut(next, guest, password)
    expectInviteSignUp(next)
  })
})
