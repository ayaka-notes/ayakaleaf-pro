import logger from '@overleaf/logger'
import Settings from '@overleaf/settings'
import { User } from '../../../app/src/models/User.mjs'
import {
  store,
  providersFile,
  listPresets,
  listKnownProviders,
  knownProvider,
  ATTRIBUTE_CATALOG,
  FILTER_OPS,
} from '../../../authentication/providers/index.mjs'
import { providerTemplate } from '../../../authentication/providers/templates.mjs'

function fail(res, status, message) {
  return res.status(status).json({ message: { type: 'error', text: message } })
}

/** The admin JSON body: either the provider object directly, or a `config`
 *  string (the JSON editor textarea) holding the provider object. */
function providerFromBody(req) {
  const body = req.body || {}
  if (typeof body.config === 'string') {
    return JSON.parse(body.config)
  }
  return body
}

const SsoAdminController = {
  // ---------- pages ----------

  indexPage(req, res) {
    const providers = store.all()
    res.render('admin/auths', {
      title: 'SSO providers',
      providers,
      presets: listPresets(),
      file: store.file,
      message: req.query.msg,
      error: req.query.error,
    })
  },

  newPage(req, res) {
    const type = ['oidc', 'oauth2', 'saml'].includes(req.query.type)
      ? req.query.type
      : 'saml'
    const preset = req.query.preset || ''
    const known = [
      ...listPresets().map(p => p.id),
      ...listKnownProviders().map(p => p.id),
    ]
    if (preset && !known.includes(preset)) {
      return fail(res, 400, `unknown preset "${preset}"`)
    }
    const template = providerTemplate(
      type,
      req.query.id,
      req.query.name,
      preset || null
    )
    res.render('admin/auths', {
      title: 'New SSO provider',
      providers: store.all(),
      presets: listPresets(),
      file: store.file,
      form: {
        mode: 'new',
        type: template.provider.type,
        preset,
        json: JSON.stringify(template.provider, null, 2),
        hints: template.hints,
        // the redirect URI the IdP/app must be registered with
        callbackPath:
          `/${template.provider.type}/${template.provider.id}/login/callback`,
      },
      catalog: ATTRIBUTE_CATALOG,
      ops: FILTER_OPS,
      message: req.query.msg,
      error: req.query.error,
    })
  },

  editPage(req, res) {
    const provider = store.get(req.params.id)
    if (!provider) {
      return res.status(404).redirect('/admin/auths?error=unknown+provider')
    }
    res.render('admin/auths', {
      title: `Edit ${provider.name}`,
      providers: store.all(),
      presets: listPresets(),
      file: store.file,
      form: {
        mode: 'edit',
        id: provider.id,
        type: provider.type,
        preset: provider.preset || '',
        json: JSON.stringify(provider, null, 2),
        readOnly: provider.source === 'env',
        hints: (provider.preset && knownProvider(provider.preset)?.hints) || [],
        callbackPath: `/${provider.type}/${provider.id}/login/callback`,
      },
      catalog: ATTRIBUTE_CATALOG,
      ops: FILTER_OPS,
      message: req.query.msg,
      error: req.query.error,
    })
  },

  // ---------- api ----------

  create(req, res) {
    let raw
    try {
      raw = providerFromBody(req)
    } catch (error) {
      return fail(res, 400, `invalid JSON: ${error.message}`)
    }
    try {
      const provider = store.upsert(raw)
      logger.info({ providerId: provider.id, type: provider.type }, 'SSO provider created/updated via admin UI')
      return res.redirect('/admin/auths?msg=provider+saved')
    } catch (error) {
      logger.warn({ err: error }, 'SSO provider validation failed')
      if (req.query?.form) {
        return res.status(400).redirect(
          `/admin/auths/new?error=${encodeURIComponent(error.message)}`
        )
      }
      return fail(res, 400, error.message)
    }
  },

  update(req, res) {
    const existing = store.get(req.params.id)
    if (!existing) {
      return fail(res, 404, 'no such provider')
    }
    if (existing.source === 'env') {
      return fail(
        res,
        400,
        `provider "${existing.id}" comes from legacy environment variables and cannot be edited here`
      )
    }
    let raw
    try {
      raw = providerFromBody(req)
      // the id cannot change: account links are keyed by it
      if (raw.id && raw.id !== req.params.id) {
        return fail(res, 400, `provider id cannot be changed (would break existing account links)`)
      }
      raw.id = req.params.id
    } catch (error) {
      return fail(res, 400, `invalid JSON: ${error.message}`)
    }
    try {
      const provider = store.upsert(raw)
      logger.info({ providerId: provider.id }, 'SSO provider updated via admin UI')
      return res.redirect('/admin/auths?msg=provider+saved')
    } catch (error) {
      logger.warn({ err: error }, 'SSO provider validation failed')
      if (req.query?.form) {
        return res.status(400).redirect(
          `/admin/auths/${encodeURIComponent(req.params.id)}/edit?error=${encodeURIComponent(error.message)}`
        )
      }
      return fail(res, 400, error.message)
    }
  },

  toggle(req, res) {
    const provider = store.get(req.params.id)
    if (!provider) {
      return fail(res, 404, 'no such provider')
    }
    if (provider.source === 'env') {
      return fail(res, 400, `provider "${provider.id}" comes from environment variables and cannot be toggled here`)
    }
    try {
      const updated = store.setEnabled(req.params.id, !provider.enabled)
      logger.info({ providerId: updated.id, enabled: updated.enabled }, 'SSO provider toggled via admin UI')
      return res.redirect('/admin/auths?msg=provider+updated')
    } catch (error) {
      return fail(res, 400, error.message)
    }
  },

  remove(req, res) {
    const provider = store.get(req.params.id)
    if (!provider) {
      return fail(res, 404, 'no such provider')
    }
    if (provider.source === 'env') {
      return fail(res, 400, `provider "${provider.id}" comes from environment variables and cannot be deleted here`)
    }
    try {
      store.remove(req.params.id)
      logger.info({ providerId: req.params.id }, 'SSO provider removed via admin UI')
      return res.redirect('/admin/auths?msg=provider+removed')
    } catch (error) {
      return fail(res, 400, error.message)
    }
  },

  /** Dry-run validation: returns the normalized provider. */
  validate(req, res) {
    let raw
    try {
      raw = providerFromBody(req)
    } catch (error) {
      return fail(res, 400, `invalid JSON: ${error.message}`)
    }
    try {
      const provider = store.validate(raw)
      return res.json({ valid: true, provider })
    } catch (error) {
      return fail(res, 400, error.message)
    }
  },

  /** Presets + attribute catalog for the UI. */
  catalog(req, res) {
    res.json({
      presets: listPresets(),
      attributes: ATTRIBUTE_CATALOG,
      ops: FILTER_OPS,
    })
  },

  /**
   * Establish a holding account (an SSO account auto-created through the
   * invited-user exception): clears `holdingAccount` so the user may create
   * new projects. Body: { userId } (or { email }).
   */
  async establishUser(req, res) {
    const body = req.body || {}
    const userId = body.userId
    const email = typeof body.email === 'string' ? body.email.toLowerCase() : null
    let user = null
    if (userId) {
      user = await User.findOne({ _id: userId }).exec().catch(() => null)
    }
    if (!user && email) {
      user = await User.findOne({ $or: [{ email }, { 'secondaryEmails.email': email }] })
        .exec()
        .catch(() => null)
    }
    if (!user) {
      return fail(res, 404, 'User not found')
    }
    user.holdingAccount = false
    await user.save()
    res.json({
      ok: true,
      user: { _id: String(user._id), email: user.email, holdingAccount: false },
    })
  },
}

export default SsoAdminController
