import Settings from '@overleaf/settings'

let MendeleyModule = {}

// Seed Settings.mendeley from MENDELEY_* env (source of truth on this base —
// no site-settings on this base), keeping any pre-seeded site_settings value.
{
  const base = Settings.mendeley || {}
  const siteUrl = String(Settings.siteUrl || '').replace(/\/+$/, '')
  Settings.mendeley = {
    ...base,
    clientID:
      base.clientID ||
      base.clientId ||
      process.env.MENDELEY_CLIENT_ID ||
      process.env.MENDELEY_CLIENT_KEY ||
      undefined,
    clientSecret: base.clientSecret || process.env.MENDELEY_CLIENT_SECRET || undefined,
    callbackURL:
      base.callbackURL ||
      process.env.MENDELEY_CALLBACK_URL ||
      `${siteUrl}/user/mendeley/oauth/callback`,
    enabled: base.enabled !== undefined ? base.enabled : true,
  }
}

MendeleyModule.router = (await import('./app/src/MendeleyRouter.mjs')).default

if (Settings.enabledLinkedFileTypes?.includes('mendeley')) {
  const { default: MendeleyLinkedFileAgent } = await import(
    './app/src/MendeleyLinkedFileAgent.mjs'
  )
  MendeleyModule.linkedFileAgents = {
    mendeley: () => MendeleyLinkedFileAgent,
  }
}

export default MendeleyModule
