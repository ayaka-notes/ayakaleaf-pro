import Settings from '@overleaf/settings'
import WakaTimeRouter from './app/src/WakaTimeRouter.mjs'

// settings.defaults.js (loaded before modules) may already define the
// `wakatime` block with env-driven defaults (OAuth, ...). Keep those
// values; this only fills in fallbacks for deployments without a
// settings.defaults.js entry.
Settings.wakatime = {
  // global on/off (routes + widgets + editor heartbeat tracking)
  enabled: process.env.WAKATIME_ENABLED !== 'false',
  debugLogging: process.env.WAKATIME_DEBUG_LOGGING === 'true',
  // WakaTime.com OAuth2 (empty clientId = OAuth button hidden)
  oauth: {
    clientId: process.env.WAKATIME_OAUTH_CLIENT_ID || '',
    clientSecret: process.env.WAKATIME_OAUTH_CLIENT_SECRET || '',
    redirectUri:
      process.env.WAKATIME_OAUTH_REDIRECT_URI ||
      `${process.env.OVERLEAF_SITE_URL || ''}/user/wakatime/oauth/callback`.replace(
        /\/$/,
        ''
      ),
    authorizeUrl:
      process.env.WAKATIME_OAUTH_AUTHORIZE_URL ||
      'https://wakatime.com/oauth/authorize',
    tokenUrl:
      process.env.WAKATIME_OAUTH_TOKEN_URL || 'https://wakatime.com/oauth/token',
    scope: process.env.WAKATIME_OAUTH_SCOPE || 'read_summaries,write_heartbeats',
    apiBaseUrl:
      process.env.WAKATIME_OAUTH_API_BASE_URL || 'https://wakatime.com/api/v1',
  },
  ...(Settings.wakatime || {}),
}

const WakaTimeModule = Settings.wakatime.enabled
  ? { router: WakaTimeRouter }
  : {}

export default WakaTimeModule
