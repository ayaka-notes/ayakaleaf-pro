import Settings from '@overleaf/settings'

/**
 * Third-party references: the reference managers Overleaf can import .bib
 * files from. One module covers them all, because core renders a single
 * `tpr-file-view-*` component (`file-view-refresh-button.tsx` and friends take
 * `.map(...)[0]`), while the per-provider UI — create-file pane, settings
 * widget, integration card — is registered once per provider in
 * settings.defaults.js.
 *
 * A provider is active when its name is in ENABLED_LINKED_FILE_TYPES and it
 * has its OAuth credentials configured.
 */
const PROVIDERS = [
  {
    id: 'zotero',
    clientIDEnv: 'ZOTERO_CLIENT_ID',
    clientSecretEnv: 'ZOTERO_CLIENT_SECRET',
    router: () => import('./app/src/ZoteroRouter.mjs'),
    linkedFileAgent: () => import('./app/src/ZoteroLinkedFileAgent.mjs'),
  },
  {
    id: 'mendeley',
    clientIDEnv: 'MENDELEY_CLIENT_ID',
    clientSecretEnv: 'MENDELEY_CLIENT_SECRET',
    router: () => import('./app/src/MendeleyRouter.mjs'),
    linkedFileAgent: () => import('./app/src/MendeleyLinkedFileAgent.mjs'),
  },
]

const siteUrl =
  process.env.OVERLEAF_SITE_URL?.replace(/\/+$/, '') || Settings.siteUrl

const routers = []
const linkedFileAgents = {}

for (const provider of PROVIDERS) {
  if (!Settings.enabledLinkedFileTypes?.includes(provider.id)) {
    continue
  }

  Settings[provider.id] = {
    // zotero: accept the bib-editor module's credential name (ZOTERO_CLIENT_KEY)
    // as an alias, so one env pair works for both the base connector and the
    // bib-editor picker.
    clientID:
      process.env[provider.clientIDEnv] ||
      (provider.id === 'zotero' ? process.env.ZOTERO_CLIENT_KEY : undefined),
    clientSecret: process.env[provider.clientSecretEnv],
    callbackURL: `${siteUrl}/user/${provider.id}/oauth/callback`,
  }

  const { default: router } = await provider.router()
  const { default: agent } = await provider.linkedFileAgent()

  routers.push(router)
  linkedFileAgents[provider.id] = () => agent
}

// A module contributes at most one router, so fan out to each enabled
// provider's router.
const TPRModule = routers.length
  ? {
      router: {
        apply(webRouter, privateApiRouter, publicApiRouter) {
          for (const router of routers) {
            router.apply(webRouter, privateApiRouter, publicApiRouter)
          }
        },
      },
      linkedFileAgents,
    }
  : {}

export default TPRModule
