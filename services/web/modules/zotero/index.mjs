import Settings from '@overleaf/settings'
import ZoteroRouter from './app/src/ZoteroRouter.mjs'

let ZoteroModule = {}

// Settings.zotero must be seeded whenever the zotero routes are mounted
// (the library-page picker uses them even when linked-file types are off),
// so seed unconditionally; credentials stay undefined until the operator
// sets them (handlers then answer “not linked” / 403s, no API traffic).
{
  const siteUrl = String(Settings.siteUrl || '').replace(/\/+$/, '')
  Settings.zotero = {
    // ZOTERO_CLIENT_KEY (bib-editor picker naming) or ZOTERO_CLIENT_ID
    // (base-connector naming) — one env pair works for both surfaces.
    clientKey: process.env.ZOTERO_CLIENT_KEY || process.env.ZOTERO_CLIENT_ID,
    clientSecret: process.env.ZOTERO_CLIENT_SECRET,
    callbackURL: `${siteUrl}/user/zotero/oauth/callback`,
  }
}

ZoteroModule.router = ZoteroRouter

if (Settings.enabledLinkedFileTypes?.includes('zotero')) {
  const { default: ZoteroLinkedFileAgent } = await import(
    './app/src/ZoteroLinkedFileAgent.mjs'
  )
  ZoteroModule.linkedFileAgents = {
    zotero: () => ZoteroLinkedFileAgent,
  }
}

export default ZoteroModule
