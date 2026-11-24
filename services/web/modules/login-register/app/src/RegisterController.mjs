import Path from 'path'
import logger from '@overleaf/logger'
import Settings from '@overleaf/settings'
import AdminAuthorizationHelper from '../../../../app/src/Features/Helpers/AdminAuthorizationHelper.mjs'
import UserRegistrationHandler from '../../../../app/src/Features/User/UserRegistrationHandler.mjs'
import AuthenticationManager from '../../../../app/src/Features/Authentication/AuthenticationManager.mjs'
import EmailHelper from '../../../../app/src/Features/Helpers/EmailHelper.mjs'
import HaveIBeenPwned from '../../../../app/src/Features/Authentication/HaveIBeenPwned.mjs'
import UserAuditLogHandler from '../../../../app/src/Features/User/UserAuditLogHandler.mjs'
import UserGetter from '../../../../app/src/Features/User/UserGetter.mjs'
import UserPagesController from '../../../../app/src/Features/User/UserPagesController.mjs'
import AuthenticationController from '../../../../app/src/Features/Authentication/AuthenticationController.mjs'
import CollaboratorsInviteGetter from '../../../../app/src/Features/Collaborators/CollaboratorsInviteGetter.mjs'
import ProjectGetter from '../../../../app/src/Features/Project/ProjectGetter.mjs'
import Features from '../../../../app/src/infrastructure/Features.mjs'
import { localLoginDisabled } from './LoginController.mjs'

// The new account goes on its own audit log, as an account made at a first
// SSO login: nobody else asked for it
function logAccountCreated(req, user) {
  UserAuditLogHandler.addEntryInBackground(
    user._id,
    'create-account',
    user._id,
    req.ip,
    {}
  )
}

// OVERLEAF_ALLOW_PUBLIC_REGISTRATION lists, separated by commas:
// 'true'             anyone signs up with a password; the other entries are
//                    then not needed and ignored
// '@<domain>'        addresses of the domain sign up with an activation email
// 'invite@<domain>'  a project invite sent by a user with an address of the
//                    domain lets the invited address sign up, whatever its
//                    domain. Opening the invite link proves the address, as an
//                    activation link does. The account logs in with a password.
// A domain is 'example.com', '*.example.com' (its subdomains at any depth, not
// example.com itself) or '*' (any domain).
function registrationEntries() {
  return (process.env.OVERLEAF_ALLOW_PUBLIC_REGISTRATION ?? '')
    .split(',')
    .map(entry => entry.trim().toLowerCase())
    .filter(Boolean)
}

// As EmailSender, which sends nothing without these parameters
const emailConfigured = () => Boolean(Settings.email?.parameters)

export function openRegistration() {
  return registrationEntries().includes('true')
}

// The email entries ('@...' for prefix '', 'invite@...' for 'invite') that
// apply: without an email server their activation emails and invites could
// not go out
function registrationDomains(prefix) {
  if (openRegistration() || !emailConfigured()) return []
  return registrationEntries()
    .filter(entry => entry.startsWith(`${prefix}@`))
    .map(entry => entry.slice(prefix.length + 1))
    .filter(Boolean)
}

function matchesDomain(domains, domain) {
  return domains.some(pattern => {
    if (pattern === '*') return true
    if (pattern.startsWith('*.')) return domain.endsWith(pattern.slice(1))
    return domain === pattern
  })
}

export function domainRegistrationEnabled() {
  return registrationDomains('').length > 0
}

function isAllowedDomain(domain) {
  return matchesDomain(registrationDomains(''), domain)
}

export function inviteRegistrationEnabled() {
  return registrationDomains('invite').length > 0 && !localLoginDisabled()
}

// Logged once at startup: email entries without an email server do nothing
export function warnAboutRegistrationWithoutEmail() {
  if (emailConfigured()) return
  const ignored = registrationEntries().filter(
    entry => entry.startsWith('@') || entry.startsWith('invite@')
  )
  if (ignored.length > 0) {
    logger.warn(
      { ignored },
      'OVERLEAF_ALLOW_PUBLIC_REGISTRATION: sign up by email needs an email server (OVERLEAF_EMAIL_FROM_ADDRESS), ignoring these entries'
    )
  }
}

// Admins could make the account themselves. Anyone else needs an address of an
// invite domain: the primary one, proven by activation or the IdP, or another
// one confirmed by its code. Guests who signed up through an invite have only
// their own address, so they cannot let more people in.
function canInviteToRegister(sender) {
  if (AdminAuthorizationHelper.hasAdminAccess(sender)) return true
  const domains = registrationDomains('invite')
  return sender.emails.some(
    ({ email, confirmedAt }) =>
      (email === sender.email || confirmedAt != null) &&
      matchesDomain(domains, EmailHelper.getDomain(email))
  )
}

// A signed-out user who opens an invite link keeps it as the post-login
// redirect: the login wall sends them to /login, viewInvite of public
// instances (OVERLEAF_ALLOW_PUBLIC_ACCESS) to /register
const INVITE_PATH = /^\/project\/([0-9a-f]{24})\/invite\/token\/([^/?]+)(\?.*)?$/

// The invite this session came with, while its address has no account yet
async function getRegistrableInvite(req) {
  if (!inviteRegistrationEnabled()) return null
  const match = INVITE_PATH.exec(
    AuthenticationController.getRedirectFromSession(req) ?? ''
  )
  if (match == null) return null
  const invite = await CollaboratorsInviteGetter.promises.getInviteByToken(
    match[1],
    match[2]
  )
  // Only an invite emailed to one address proves it: sharing links have none
  if (invite?.email == null || invite.reusable) return null
  // An address with an account logs in instead
  if (await UserGetter.promises.getUserByAnyEmail(invite.email, { _id: 1 })) {
    return null
  }
  // As viewInvite, which shows an invite only while both exist
  const [owner, project] = await Promise.all([
    UserGetter.promises.getUser(invite.sendingUserId, {
      first_name: 1,
      email: 1,
      emails: 1,
      isAdmin: 1,
    }),
    ProjectGetter.promises.getProject(invite.projectId, { name: 1 }),
  ])
  if (owner == null || project == null || !canInviteToRegister(owner)) {
    return null
  }
  return {
    email: invite.email,
    ownerFirstName: owner.first_name,
    projectName: project.name,
  }
}

export default {
  async registerPage(req, res, next) {
    // Check if the user is already logged in
    if (req.user != null) {
      return res.redirect(`/`)
    }

    const invite = await getRegistrableInvite(req)
    if (
      invite == null &&
      !openRegistration() &&
      !domainRegistrationEnabled()
    ) {
      // Only invites may sign up and this is none: as without the option, CE
      // asks to contact the admin and SSO instances have no page
      if (Features.hasFeature('registration-page')) {
        return UserPagesController.registerPage(req, res)
      }
      return res.redirect('/login')
    }

    const showPasswordField = invite == null && openRegistration()

    // If not logged in, render the registration page
    const __dirname = Path.dirname(new URL(import.meta.url).pathname)
    res.render(Path.resolve(__dirname, '../views/user/register'), {
      showPasswordField,
      invite,
      csrfToken: req.csrfToken(),
    })
  },

  // The login page offers to sign up to whoever came with such an invite
  async inviteForLoginPage(req, res, next) {
    res.locals.registerViaInvite = (await getRegistrableInvite(req)) != null
    next()
  },

  // Makes the invited address an account and sends it on to the activation
  // page, which sets the password, logs in and returns to the invite. The
  // activation email also goes out, for a guest who leaves before that.
  async registerWithInvite(req, res, next) {
    const invite = await getRegistrableInvite(req)
    // The invite is gone, or its address has an account by now
    if (invite == null) {
      return res.json({ redir: '/login' })
    }
    const { user, setNewPasswordUrl } =
      await UserRegistrationHandler.promises.registerNewUserAndSendActivationEmail(
        invite.email
      )
    logAccountCreated(req, user)
    const { pathname, search } = new URL(setNewPasswordUrl)
    res.json({ redir: pathname + search })
  },

  // Deal with user registration requests via email
  async registerWithEmail(req, res, next) {
    const { email } = req.body
    if (email == null || email === '') {
      return res.sendStatus(422) // Unprocessable Entity
    }

    // Validate email format before attempting to register the user
    const invalidEmail = AuthenticationManager.validateEmail(email)
    if (invalidEmail) {
      return res.status(400).json({
        message: {
          type: 'error',
          text: invalidEmail.message,
        }
      })
    }

    const domain = EmailHelper.getDomain(email)
    if (domain == null || !isAllowedDomain(domain)) {
      return res.status(400).json({
        message: 'Email domain not allowed for registration',
      })
    }

    // core only sends the activation email again to an address that has an
    // account, looked up as core's registerNewUser does
    const existing = await UserGetter.promises.getUserByAnyEmail(
      EmailHelper.parseEmail(email),
      { _id: 1 }
    )
    UserRegistrationHandler.registerNewUserAndSendActivationEmail(
      email,
      (error, user, setNewPasswordUrl) => {
        if (error != null) {
          return next(error)
        }
        if (!existing) logAccountCreated(req, user)
        return res.status(200).json({
          message: 'Registration successful. Please check your email to activate your account.',
        })
      }
    )
  },

  // Deal with user registration requests via username and password
  async registerWithUsernameAndPassword(req, res, next) {
    const { email, password } = req.body
    if (email == null || email === '' || password == null || password === '') {
      return res.sendStatus(422) // Unprocessable Entity
    }

    // Validate email and password format before attempting to register the user
    const invalidEmail = AuthenticationManager.validateEmail(email)
    if (invalidEmail) {
      return res.status(400).json({
        message: {
          type: 'error',
          text: invalidEmail.message,
        }
      })
    }

    const invalidPassword = AuthenticationManager.validatePassword(password, email)
    if (invalidPassword) {
      return res.status(400).json({
        message: {
          type: 'error',
          text: invalidPassword.message,
        }
      })
    }

    // Check if the password has been seen in a data breach before allowing the user to register with it
    let isPasswordReused
    try {
      isPasswordReused = await HaveIBeenPwned.promises.checkPasswordForReuse(password)
    } catch (error) {
      logger.error({ err: error }, 'Error checking password against HaveIBeenPwned')
    }

    if (isPasswordReused) {
      return res.status(400).json({
        message: {
          type: 'error',
          key: 'password-must-be-strong',
          text: 'This password has been seen in a data breach and cannot be used. Please choose a different password.',
        }
      })
    }

    const userDetails = {
      email: email,
      password: password,
      analyticsId: crypto.randomUUID(),
    }

    UserRegistrationHandler.registerNewUser(
      userDetails,
      (error, user) => {
        if (error != null) {
          logger.debug({ err: error }, 'error registering user')
          // Sets like "Email already in use" are communicated back to the client
          return res.status(400).json({
            message: error.message,
          })
        }

        // Registration successful
        logAccountCreated(req, user)
        return res.json(
          {
            redir: '/login',
          }
        )
      }
    )

  }
}

