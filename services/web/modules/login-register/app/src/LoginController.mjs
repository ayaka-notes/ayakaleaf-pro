import AuthenticationController from "../../../../app/src/Features/Authentication/AuthenticationController.mjs"
import Settings from "@overleaf/settings"
import Path from 'path'

// Only when users have another way to log in, so nobody gets locked out
export const localLoginDisabled = () =>
  process.env.OVERLEAF_DISABLE_LOCAL_LOGIN === 'true' &&
  Boolean(Settings.ldap?.enable || Settings.saml?.enable || Settings.oidc?.enable)

export default {
  async loginPage(req, res, next) {
    // return res.json({ message: 'Login successful' })
    // if user is being sent to /login with explicit redirect (redir=/foo),
    // such as being sent from the editor to /login, then set the redirect explicitly
    if (
      req.query.redir != null &&
      AuthenticationController.getRedirectFromSession(req) == null
    ) {
      AuthenticationController.setRedirectInSession(req, req.query.redir)
    }
    // A link-only SSO source (e.g. ORCID) refused an unlinked identity and
    // bounced back to /login with the provider name: tell the user they can
    // log in another way first and link the account from the settings page.
    // The provider name is echoed into the page, so only accept names of
    // providers that are actually configured (otherwise the value is a
    // reflection vector — the template must escape it regardless).
    let ssoIntercept
    if (req.query.sso_error === 'not_linked' && typeof req.query.provider === 'string') {
      const known = (Settings.ssoProviders || []).map(p => p?.name).filter(Boolean)
      if (known.includes(req.query.provider)) {
        ssoIntercept = { key: 'register_intercept_sso', providerName: req.query.provider }
      }
    }
    const metadata = { robotsNoindexNofollow: false }
    if (Object.keys(req.query).length !== 0) {
      metadata.robotsNoindexNofollow = true
    }
    const __dirname = Path.dirname(new URL(import.meta.url).pathname)
    res.render(Path.resolve(__dirname, '../views/user/login'), {
      title: Settings.nav?.login_support_title || 'login',
      login_support_title: Settings.nav?.login_support_title,
      login_support_text: Settings.nav?.login_support_text,
      localLoginDisabled: localLoginDisabled(),
      ssoIntercept,
      metadata,
    })
  },

  async ldapLoginPage(req, res, next) {
    // return res.json({ message: 'Login successful' })
    // if user is being sent to /login with explicit redirect (redir=/foo),
    // such as being sent from the editor to /login, then set the redirect explicitly
    if (
      req.query.redir != null &&
      AuthenticationController.getRedirectFromSession(req) == null
    ) {
      AuthenticationController.setRedirectInSession(req, req.query.redir)
    }
    const metadata = { robotsNoindexNofollow: false }
    if (Object.keys(req.query).length !== 0) {
      metadata.robotsNoindexNofollow = true
    }
    const __dirname = Path.dirname(new URL(import.meta.url).pathname)
    res.render(Path.resolve(__dirname, '../views/user/ldap-login'), {
      title: Settings.nav?.login_support_title || 'login',
      login_support_title: Settings.nav?.login_support_title,
      login_support_text: Settings.nav?.login_support_text,
      metadata,
    })
  }
}