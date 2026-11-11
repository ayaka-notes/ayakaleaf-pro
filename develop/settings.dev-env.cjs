// OVERLEAF_CONFIG of web. Merges the settings of every feature turned on in
// dev.rc: each one mounts its own file into /etc/overleaf/settings.d/.
const fs = require('node:fs')
const { merge } = require('@overleaf/settings/merge')

module.exports = fs
  .globSync('/etc/overleaf/settings.d/*.cjs')
  .sort()
  .reduce((settings, file) => merge(require(file), settings), {})
