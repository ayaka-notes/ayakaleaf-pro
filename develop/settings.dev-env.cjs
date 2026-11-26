// OVERLEAF_CONFIG of web. Merges the settings of every feature turned on in
// dev.rc: each one mounts its own file into /etc/overleaf/settings.d/.
const fs = require('node:fs')
const { merge } = require('@overleaf/settings/merge')

// Fixed secrets for the dev environment, like the examples in dev.env. They
// only encrypt tokens stored in Mongo; a value set in dev.env wins. OAuth
// clients and API keys are real accounts and stay in dev.env.
const DEV_SECRETS = {
  OVERLEAF_INVITE_TOKEN_SECRET: 'dev-environment-invite-token-secret',
  GITHUB_TOKEN_CIPHER_PASSWORD: 'dev-environment-github-token-cipher-password',
  GITLAB_TOKEN_CIPHER_PASSWORD: 'dev-environment-gitlab-token-cipher-password',
  GITEA_TOKEN_CIPHER_PASSWORD: 'dev-environment-gitea-token-cipher-password',
  // Without ZOTERO_CIPHER_PASSWORD and MENDELEY_CIPHER_PASSWORD, tpr-webmodule
  // writes a key file to /var/lib/overleaf/data, which the dev web container
  // cannot create
  ZOTERO_CIPHER_PASSWORD: 'dev-environment-zotero-cipher-password',
  MENDELEY_CIPHER_PASSWORD: 'dev-environment-mendeley-cipher-password',
}
for (const [name, value] of Object.entries(DEV_SECRETS)) {
  process.env[name] ||= value
}

const settings = fs
  .globSync('/etc/overleaf/settings.d/*.cjs')
  .sort()
  .reduce((settings, file) => merge(require(file), settings), {})

// A "Dev tools" menu in the navbar for logged-in users, with the tools that
// webpack-dev-server serves on paths of the site, each in a new window. A
// feature adds its own tool to devTools in its settings file; mongo-express
// and Redis Insight always run.
settings.nav = {
  header_extras: [
    {
      text: 'Dev tools',
      class: 'subdued',
      only_when_logged_in: true,
      dropdown: [
        ...Object.values(settings.devTools || {}),
        { text: 'Mongo Express', url: '/mongo-express/' },
        { text: 'Redis Insight', url: '/redis-insight/' },
      ].map(tool => ({ ...tool, openInNewWindow: true })),
    },
  ],
}

// The image reads this in server-ce/config/settings.js; settings.defaults.js,
// which the dev environment loads, does not
settings.projectInviteEncryptorOptions = {
  cipherLabel: '2026.3-v3',
  cipherPasswords: { '2026.3-v3': process.env.OVERLEAF_INVITE_TOKEN_SECRET },
}

module.exports = settings
