/**
 * Invited-user lookup: can this email collaborate here, i.e. does it have a
 * pending project or team invitation? Invited users get an exception to the
 * profile filter (if the provider allows it) so that a collaborator who was
 * invited by email can autocreate an account via SSO even if their profile
 * does not match the institution filter.
 */

import { ProjectInvite } from '../../../app/src/models/ProjectInvite.mjs'
import { TeamInvite } from '../../../app/src/models/TeamInvite.mjs'

/**
 * @param {string} email
 * @returns {Promise<{invited: boolean, via: 'project'|'team'|null}>}
 */
export async function hasPendingInvite(email) {
  if (!email) return { invited: false, via: null }
  const e = email.toLowerCase()
  const now = Date.now()
  const [projectInvite, teamInvite] = await Promise.all([
    ProjectInvite.findOne({ email: e }).lean().catch(() => null),
    TeamInvite.findOne({ email: e }).lean().catch(() => null),
  ])
  if (
    projectInvite &&
    (!projectInvite.expires || new Date(projectInvite.expires).getTime() > now)
  ) {
    return { invited: true, via: 'project' }
  }
  if (teamInvite) {
    return { invited: true, via: 'team' }
  }
  return { invited: false, via: null }
}

export default { promises: { hasPendingInvite } }
