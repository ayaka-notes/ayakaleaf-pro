import logger from '@overleaf/logger'
import Settings from '@overleaf/settings'
import { store, registerSsoProviders } from '../../../providers/index.mjs'
import { setPassport } from '../../../providers/passport.mjs'
import OAuth2AuthenticationController from './OAuth2AuthenticationController.mjs'
import { Strategy as OAuth2Strategy } from 'passport-oauth2'
const siteUrl = () => Settings.siteUrl.replace(/\/+$/, '')

/**
 * Build the passport profile for one provider from its user API
 * (and optional email API). Mirrors what Forgejo does for its OAuth2
 * sources: `userUrl` gives the identity, `emailUrl` (when configured)
 * gives the email list with primary/verified flags.
 */
/**
 * Build the passport `userProfile` override for one provider: fetch the user
 * API (and optional email API) and map it to the passport profile shape.
 * passport-oauth2's default `userProfile` returns an empty object, so this
 * override is the extension point (subclasses like passport-github do the
 * same).
 */
function userProfileFn(provider) {
  return (accessToken, done) => {
    const { userUrl, emailUrl, apiAcceptHeader } = provider.oauth2
    const headers = {
      Accept: apiAcceptHeader || 'application/json',
      Authorization: `Bearer ${accessToken}`,
    }
    const text = async url => (await (await fetch(url, { headers })).json())
    Promise.resolve()
      .then(async () => {
        const user = await text(userUrl)
        let emails = []
        if (emailUrl) {
          try {
            const list = await text(emailUrl)
            const arr = Array.isArray(list) ? list : [list]
            emails = arr
              .filter(e => e && e.email)
              .map(e => ({
                value: e.email,
                primary: Boolean(e.primary),
                verified: Boolean(
                  e.verified ?? e.verifiedEmail ?? e.email_verified ?? e['verified_email']
                ),
              }))
          } catch {
            // the email call failed (scope, network); the manager decides
            // whether an email is mandatory for this provider
          }
        }
        if (!emails.length && typeof user.email === 'string' && user.email) {
          emails = [
            {
              value: user.email,
              primary: true,
              verified: Boolean(
                user.email_verified ?? user.verified_email ?? user.emailVerified
              ),
            },
          ]
        }
        const id =
          user[provider.attrs.userId] ?? user.id ?? user.login ?? user.username ?? user.uid
        if (id === undefined || id === null) {
          throw new Error('OAuth2 user profile has no usable identity')
        }
        done(null, {
          id: String(id),
          displayName:
            user.name || user.display_name || user.login || user.username || '',
          emails,
          _json: user,
        })
      })
      .catch(error => done(error))
  }
}
function oauth2StrategyOptions(provider) {
  const { oauth2 } = provider
  return {
    authorizationURL: oauth2.authorizeUrl,
    tokenURL: oauth2.tokenUrl,
    clientID: oauth2.clientId,
    clientSecret: oauth2.clientSecret,
    scope: oauth2.scope || false,
    passReqToCallback: true,
    callbackURL: `${siteUrl()}/oauth2/${encodeURIComponent(provider.id)}/login/callback`,
    // keep per-provider session/state keys separate (same-hostname case)
    sessionKey: `overleaf-oauth2:${provider.id}`,
  }
}
function createStrategy(provider) {
  const strategy = new OAuth2Strategy(
    oauth2StrategyOptions(provider),
    OAuth2AuthenticationController.doPassportLogin(provider)
  )
  strategy.name = `oauth2:${provider.id}`
  strategy.userProfile = userProfileFn(provider)
  return strategy
}
const OAuth2ModuleManager = {
  /**
   * Expose the OAuth2 providers on Settings (flat shape + the full list) and
   * register them on `Settings.oauthProviders` so the settings page's
   * linked-accounts section and `ThirdPartyIdentityManager.link` accept the
   * provider ids.
   */
  initSettings() {
    const providers = store.ofType('oauth2')
    Settings.oauth2 = {
      enable: providers.length > 0,
      providers,
    }
    if (!providers.length) {
      const active = new Set()
      for (const key of Object.keys(Settings.oauthProviders || {})) {
        const linkPath = String(Settings.oauthProviders[key]?.linkPath ?? '')
        if (linkPath.startsWith('/oauth2/') && !active.has(key)) {
          delete Settings.oauthProviders[key]
        }
      }
      registerSsoProviders(Settings, 'oauth2', [])
      return
    }
    Settings.oauthProviders = Settings.oauthProviders || {}
    const active = new Set(providers.map(provider => provider.id))
    for (const key of Object.keys(Settings.oauthProviders)) {
      const linkPath = String(Settings.oauthProviders[key]?.linkPath ?? '')
      if (linkPath.startsWith('/oauth2/') && !active.has(key)) {
        delete Settings.oauthProviders[key]
      }
    }
    for (const provider of providers) {
      Settings.oauthProviders[provider.id] = {
        name: provider.name,
        linkPath: `/oauth2/${encodeURIComponent(provider.id)}/login`,
        ...(provider.behavior.linkOnly ? { hideWhenNotLinked: false } : {}),
      }
    }
    registerSsoProviders(Settings, 'oauth2', providers)
  },
  /**
   * Register one passport strategy per enabled provider.
   * Strategy names: `oauth2:<id>`.
   */
  passportSetup(passport, callback) {
    setPassport(passport)
    const providers = store.ofType('oauth2')
    if (!providers.length) {
      // no providers yet: the admin UI can add them live
      return callback(null)
    }
    for (const provider of providers) {
      let strategy
      try {
        strategy = createStrategy(provider)
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
    for (const provider of store.ofType('oauth2')) {
      passport.use(createStrategy(provider))
    }
    // unuse removed providers
    const active = new Set(store.ofType('oauth2').map(p => `oauth2:${p.id}`))
    for (const name of Object.keys(passport._strategies)) {
      if (name.startsWith('oauth2:') && !active.has(name)) {
        passport.unuse(name)
      }
    }
    logger.info({}, 'oauth2: passport strategies (re)registered')
  },
}
export default OAuth2ModuleManager
