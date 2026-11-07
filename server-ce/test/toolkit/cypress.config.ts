import { defineConfig } from 'cypress'
import { plugin as cypressGrepPlugin } from '@cypress/grep/plugin'

// Folder whose own *.spec.ts files to run, e.g. suites/login-register or the
// variant suites/login-register/domain. Set by bin/run-suite.
const specDir = process.env.SPEC_DIR
if (!specDir) {
  throw new Error('SPEC_DIR is not set, run the tests via `make test_<suite>`')
}

// Cypress empties both folders when it starts, so each local instance
// (INSTANCE in the Makefile) has its own
const suffix = process.env.INSTANCE ? `-${process.env.INSTANCE}` : ''

export default defineConfig({
  defaultCommandTimeout: 10_000,
  fixturesFolder: false,
  video: false,
  screenshotsFolder: `cypress/results${suffix}`,
  downloadsFolder: `cypress/downloads${suffix}`,
  viewportHeight: 768,
  viewportWidth: 1024,
  // Only the cases whose full title contains GREP, e.g. `make test GREP=...`
  expose: process.env.GREP
    ? { grep: process.env.GREP, grepFilterSpecs: true, grepOmitFiltered: true }
    : {},
  e2e: {
    specPattern: `${specDir}/*.spec.ts`,
    supportFile: '../cypress/support/e2e.ts',
    setupNodeEvents(on, config) {
      cypressGrepPlugin(config)
      return config
    },
  },
})
