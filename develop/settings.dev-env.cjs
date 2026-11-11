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

// The image reads this in server-ce/config/settings.js; settings.defaults.js,
// which the dev environment loads, does not
settings.projectInviteEncryptorOptions = {
  cipherLabel: '2026.3-v3',
  cipherPasswords: { '2026.3-v3': process.env.OVERLEAF_INVITE_TOKEN_SECRET },
}

module.exports = settings
