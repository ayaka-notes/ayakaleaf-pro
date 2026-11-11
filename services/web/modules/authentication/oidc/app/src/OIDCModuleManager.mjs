import logger from '@overleaf/logger'
import Settings from '@overleaf/settings'
import { hasPassword } from '../../../utils.mjs'
import PermissionsManager from '../../../../../app/src/Features/Authorization/PermissionsManager.mjs'
import { store, registerSsoProviders } from '../../../providers/index.mjs'
import { setPassport } from '../../../providers/passport.mjs'
import OIDCAuthenticationController from './OIDCAuthenticationController.mjs'
import { Strategy as OIDCStrategy } from 'passport-openidconnect'

const siteUrl = () => Settings.siteUrl.replace(/\/+$/, '')

/**
 * Build the passport-openidconnect options object for one provider.
 */
function oidcStrategyOptions(provider) {
  const { oidc } = provider
  const options = {
    authorizationURL: oidc.authorizationUrl,
    tokenURL: oidc.tokenUrl,
    userInfoURL: oidc.userInfoUrl,
    clientID: oidc.clientId,
    clientSecret: oidc.clientSecret,
    scope: oidc.scope,
    passReqToCallback: true,
  }
  if (oidc.issuer) options.issuer = oidc.issuer
  options.callbackURL = `${siteUrl()}/oidc/${encodeURIComponent(provider.id)}/login/callback`
  // keep per-provider session/state keys separate (same IdP hostname case)
  options.sessionKey = `overleaf-oidc:${provider.id}`
  return options
}

const OIDCModuleManager = {
  /**
   * Expose the OIDC providers on Settings (legacy single-provider shape for
   * old consumers + the full `providers` list) and register the
   * oauthProviders used by the login and settings pages.
   */
  initSettings() {
    const providers = store.ofType('oidc')
    const legacy = store.get('oidc')
    const first = legacy ?? providers[0]
    if (!first) {
      // keep the flag shape so `Settings.oidc.enable` checks keep working
      Settings.oidc = { enable: false, providers: [] }
      return
    }
    Settings.oidc = {
      enable: true,
      providerId: first.id,
      identityServiceName: first.name,
      // legacy flat fields (first provider) for old code paths
      attUserId: first.attrs.userId,
      attAdmin: first.attrs.admin?.field,
      valAdmin: first.attrs.admin?.values?.[0],
      updateUserDetailsOnLogin: first.behavior.updateUserDetailsOnLogin,
      allowedOIDCEmailDomains: first.behavior.allowedEmailDomains,
      providers,
    }
    Settings.oauthProviders = Settings.oauthProviders || {}
    // Drop stale OIDC entries (identified by their /oidc/ link path) so that
    // providers removed via the admin UI disappear from the linked-accounts UI.
    const activeOidc = new Set(providers.map(provider => provider.id))
    for (const key of Object.keys(Settings.oauthProviders)) {
      const linkPath = String(Settings.oauthProviders[key]?.linkPath ?? '')
      if (linkPath.startsWith('/oidc/') && !activeOidc.has(key)) {
        delete Settings.oauthProviders[key]
      }
    }
    for (const provider of providers) {
      Settings.oauthProviders[provider.id] = {
        name: provider.name,
        linkPath: `/oidc/${encodeURIComponent(provider.id)}/login`,
        hideWhenNotLinked: provider.oidc.hideWhenNotLinked,
        ...(provider.descriptionKey
          ? { descriptionKey: provider.descriptionKey }
          : {}),
        ...(provider.descriptionOptions
          ? { descriptionOptions: provider.descriptionOptions }
          : {}),
      }
    }
    registerSsoProviders(Settings, 'oidc', providers)
  },

  /**
   * Register one passport strategy per enabled provider.
   * Strategy names: `oidc:<id>`.
   */
  passportSetup(passport, callback) {
    setPassport(passport)
    const providers = store.ofType('oidc')
    if (!providers.length) {
      // no providers yet: the admin UI can add them live
      return callback(null)
    }
    for (const provider of providers) {
      let strategy
      try {
        strategy = new OIDCStrategy(
          oidcStrategyOptions(provider),
          OIDCAuthenticationController.doPassportLogin(provider)
        )
        strategy.name = `oidc:${provider.id}`
        passport.use(strategy)
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
    for (const provider of store.ofType('oidc')) {
      const strategy = new OIDCStrategy(
        oidcStrategyOptions(provider),
        OIDCAuthenticationController.doPassportLogin(provider)
      )
      strategy.name = `oidc:${provider.id}`
      passport.use(strategy)
    }
    // unuse removed providers
    const active = new Set(store.ofType('oidc').map(p => `oidc:${p.id}`))
    for (const name of Object.keys(passport._strategies)) {
      if (name.startsWith('oidc:') && !active.has(name)) {
        passport.unuse(name)
      }
    }
    this.initSettings()
  },

  initPolicy() {
    try {
      PermissionsManager.registerCapability('change-password', { default: true })
      PermissionsManager.registerCapability('use-ai', { default: false })
    } catch (error) {
      logger.info({}, error.message)
    }
    const oidcPolicyValidator = async ({ user, subscription }) => {
      // Only an account without a local password may not set one: LDAP and
      // SAML remove the password on login, OIDC keeps the one of a local account
      return !(await hasPassword(user._id))
    }
    try {
      PermissionsManager.registerPolicy(
        'oidcPolicy',
        { 'change-password': false },
        { validator: oidcPolicyValidator }
      )
    } catch (error) {
      logger.info({}, error.message)
    }
  },

  getGroupPolicyForUser(user, callback) {
    PermissionsManager.promises.getUserValidationStatus({
      user,
      groupPolicy: { 'oidcPolicy': true },
      subscription: null
    }).then(userValidationMap => {
      let groupPolicy = Object.fromEntries(userValidationMap)
      callback(null, { groupPolicy })
    }).catch(error => {
      callback(error)
    })
  },
}

export default OIDCModuleManager
