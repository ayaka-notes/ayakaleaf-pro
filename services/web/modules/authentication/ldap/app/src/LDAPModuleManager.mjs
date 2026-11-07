import logger from '@overleaf/logger'
import { Strategy as LDAPStrategy } from 'passport-ldapauth'
import Settings from '@overleaf/settings'
import PermissionsManager from '../../../../../app/src/Features/Authorization/PermissionsManager.mjs'
import { readFilesContentFromEnv, numFromEnv, boolFromEnv, hasPassword } from '../../../utils.mjs'
import LDAPAuthenticationController from './LDAPAuthenticationController.mjs'
import fetchLDAPContacts from './LDAPContacts.mjs'

const LDAPModuleManager = {
  initSettings() {
    Settings.ldap = {
      enable: true,
      identityServiceName: process.env.OVERLEAF_LDAP_IDENTITY_SERVICE_NAME || 'Log in with LDAP Provider',
      placeholder:  process.env.OVERLEAF_LDAP_PLACEHOLDER || 'Username',
      attEmail:     process.env.OVERLEAF_LDAP_EMAIL_ATT || 'mail',
      attFirstName: process.env.OVERLEAF_LDAP_FIRST_NAME_ATT,
      attLastName:  process.env.OVERLEAF_LDAP_LAST_NAME_ATT,
      attName:      process.env.OVERLEAF_LDAP_NAME_ATT,
      attAdmin:     process.env.OVERLEAF_LDAP_IS_ADMIN_ATT,
      valAdmin:     process.env.OVERLEAF_LDAP_IS_ADMIN_ATT_VALUE,
      updateUserDetailsOnLogin: boolFromEnv(process.env.OVERLEAF_LDAP_UPDATE_USER_DETAILS_ON_LOGIN),
    }
  },
  passportSetup(passport, callback) {
    const ldapOptions = {
      url: process.env.OVERLEAF_LDAP_URL,
      bindDN: process.env.OVERLEAF_LDAP_BIND_DN || "",
      bindCredentials: process.env.OVERLEAF_LDAP_BIND_CREDENTIALS || "",
      bindProperty: process.env.OVERLEAF_LDAP_BIND_PROPERTY,
      searchBase: process.env.OVERLEAF_LDAP_SEARCH_BASE,
      searchFilter: process.env.OVERLEAF_LDAP_SEARCH_FILTER,
      searchScope: process.env.OVERLEAF_LDAP_SEARCH_SCOPE || 'sub',
      searchAttributes: JSON.parse(process.env.OVERLEAF_LDAP_SEARCH_ATTRIBUTES || null),
      cache: boolFromEnv(process.env.OVERLEAF_LDAP_CACHE),
      timeout: numFromEnv(process.env.OVERLEAF_LDAP_TIMEOUT),
      connectTimeout: numFromEnv(process.env.OVERLEAF_LDAP_CONNECT_TIMEOUT),
      starttls: boolFromEnv(process.env.OVERLEAF_LDAP_STARTTLS),
      tlsOptions: {
        ca: readFilesContentFromEnv(process.env.OVERLEAF_LDAP_TLS_OPTS_CA_PATH),
        rejectUnauthorized: boolFromEnv(process.env.OVERLEAF_LDAP_TLS_OPTS_REJECT_UNAUTH),
      },
      log: logger.logger,
    }
    try {
      passport.use(
        'ldapauth',
        new LDAPStrategy(
          {
            server: ldapOptions,
            passReqToCallback: true,
            usernameField: 'login',
            passwordField: 'password',
            handleErrorsAsFailures: true,
          },
          LDAPAuthenticationController.doPassportLogin
        )
      )
      callback(null)
    } catch (error) {
      logger.error({ err: error.message }, 'Error setting up LDAP passport strategy')
      callback(error)
    }
  },

  async getContacts(userId, contacts, callback) {
    try {
      const newContacts = await fetchLDAPContacts(userId, contacts)
      callback(null, newContacts)
    } catch (error) {
      callback(error)
    }
  },

  initPolicy() {
    try {
      PermissionsManager.registerCapability('change-password', { default : true })
      PermissionsManager.registerCapability('use-ai', { default : false })
    } catch (error) {
      logger.info({}, error.message)
    }
    const ldapPolicyValidator = async ({ user, subscription }) => {
      // Only an account without a local password may not set one: LDAP and
      // SAML remove the password on login, OIDC keeps the one of a local account
      return !(await hasPassword(user._id))
    }
    try {
    PermissionsManager.registerPolicy(
      'ldapPolicy',
      { 'change-password' : false },
      { validator: ldapPolicyValidator }
    )
    } catch (error) {
      logger.info({}, error.message)
    }
  },

  getGroupPolicyForUser(user, callback) {
    PermissionsManager.promises.getUserValidationStatus({
      user,
      groupPolicy : { 'ldapPolicy' : true },
      subscription : null
    }).then(userValidationMap => {
      let groupPolicy = Object.fromEntries(userValidationMap)
      callback(null, { groupPolicy })
    }).catch(error => {
      callback(error)
    })
  },
}

export default LDAPModuleManager
