import logger from '@overleaf/logger'
import Settings from '@overleaf/settings'
import { hasPassword } from '../../../utils.mjs'
import PermissionsManager from '../../../../../app/src/Features/Authorization/PermissionsManager.mjs'
import { store, registerSsoProviders } from '../../../providers/index.mjs'
import { setPassport } from '../../../providers/passport.mjs'
import SAMLAuthenticationController from './SAMLAuthenticationController.mjs'
import { Strategy as SAMLStrategy } from '@node-saml/passport-saml'

const siteUrl = () => Settings.siteUrl.replace(/\/+$/, '')

/**
 * Build the passport-saml options for one IdP provider.
 */
function samlStrategyOptions(provider) {
  const s = provider.saml
  const options = {
    // distinct passport strategy name per IdP (supported by passport-saml)
    name: `saml:${provider.id}`,
    entryPoint: s.entryPoint,
    callbackUrl: `${siteUrl()}/saml/${encodeURIComponent(provider.id)}/login/callback`,
    audience: s.audience,
    idpCert: s.idpCert,
    privateKey: s.privateKey,
    decryptionPvk: s.decryptionPvk,
    signatureAlgorithm: s.signatureAlgorithm,
    additionalParams: s.additionalParams || {},
    additionalAuthorizeParams: s.additionalAuthorizeParams || {},
    identifierFormat: s.identifierFormat,
    acceptedClockSkewMs: s.acceptedClockSkewMs,
    attributeConsumingServiceIndex: s.attributeConsumingServiceIndex,
    authnContext: s.authnContext,
    forceAuthn: Boolean(s.forceAuthn),
    disableRequestedAuthnContext: Boolean(s.disableRequestedAuthnContext),
    validateInResponseTo: s.validateInResponseTo,
    requestIdExpirationPeriodMs: s.requestIdExpirationPeriodMs,
    logoutUrl: s.logoutUrl,
    logoutCallbackUrl: `${siteUrl()}/saml/${encodeURIComponent(provider.id)}/logout/callback`,
    additionalLogoutParams: s.additionalLogoutParams || {},
    wantAssertionsSigned: Boolean(s.wantAssertionsSigned),
    wantAuthnResponseSigned: Boolean(s.wantAuthnResponseSigned),
    passReqToCallback: true,
  }
  // node-saml requires an SP issuer (entityID); default to a stable value
  options.issuer = s.spIssuer || `overleaf-saml-${provider.id}`
  if (s.authnRequestBinding) {
    options.authnRequestBinding = s.authnRequestBinding
    // compression should be skipped iff authnRequestBinding is POST
    options.skipRequestCompression = s.authnRequestBinding === 'HTTP-POST'
  }
  return options
}

function registerStrategy(passport, provider) {
  const strategy = new SAMLStrategy(
    samlStrategyOptions(provider),
    SAMLAuthenticationController.doPassportLogin(provider),
    SAMLAuthenticationController.doPassportLogout(provider)
  )
  passport.use(strategy)
}

const SAMLModuleManager = {
  /**
   * Expose the SAML IdPs on Settings (legacy single-IdP shape for old
   * consumers + the full `providers` list) and the login-page buttons.
   */
  initSettings() {
    const providers = store.ofType('saml')
    const legacy = store.get('1')
    const first = legacy ?? providers[0]
    if (!first) {
      Settings.saml = { enable: false, providers: [] }
      return
    }
    Settings.saml = {
      enable: true,
      identityServiceName: first.name,
      attUserId: first.attrs.userId,
      attEmail: first.attrs.email,
      attFirstName: first.attrs.firstName,
      attLastName: first.attrs.lastName,
      attAdmin: first.attrs.admin?.field,
      valAdmin: first.attrs.admin?.values?.[0],
      updateUserDetailsOnLogin: first.behavior.updateUserDetailsOnLogin,
      providers,
    }
    registerSsoProviders(Settings, 'saml', providers)
  },

  passportSetup(passport, callback) {
    setPassport(passport)
    const providers = store.ofType('saml')
    if (!providers.length) {
      // no IdPs yet: the admin UI can add them live
      return callback(null)
    }
    for (const provider of providers) {
      try {
        registerStrategy(passport, provider)
      } catch (error) {
        return callback(error)
      }
    }
    callback(null)
  },

  /**
   * (Re)register strategies after a store change from the admin UI.
   */
  refreshStrategies(passport) {
    for (const provider of store.ofType('saml')) {
      registerStrategy(passport, provider)
    }
    const active = new Set(store.ofType('saml').map(p => `saml:${p.id}`))
    for (const name of Object.keys(passport._strategies)) {
      if (name.startsWith('saml:') && !active.has(name)) {
        passport.unuse(name)
      }
    }
    this.initSettings()
  },

  initPolicy() {
    try {
      PermissionsManager.registerCapability('change-password', { default : true })
      PermissionsManager.registerCapability('use-ai', { default : false })
    } catch (error) {
      logger.info({}, error.message)
    }
    const samlPolicyValidator = async ({ user, subscription }) => {
      // Only an account without a local password may not set one: LDAP and
      // SAML remove the password on login, OIDC keeps the one of a local account
      return !(await hasPassword(user._id))
    }
    try {
      PermissionsManager.registerPolicy(
        'samlPolicy',
        { 'change-password' : false },
        { validator: samlPolicyValidator }
      )
    } catch (error) {
      logger.info({}, error.message)
    }
  },

  getGroupPolicyForUser(user, callback) {
    PermissionsManager.promises.getUserValidationStatus({
      user,
      groupPolicy : { 'samlPolicy' : true },
      subscription : null
    }).then(userValidationMap => {
      let groupPolicy = Object.fromEntries(userValidationMap)
      callback(null, { groupPolicy })
    }).catch(error => {
      callback(error)
    })
  },
}

export default SAMLModuleManager
