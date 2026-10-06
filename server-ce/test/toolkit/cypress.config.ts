import { defineConfig } from 'cypress'

// Folder whose own *.spec.ts files to run, e.g. suites/login-register or the
// variant suites/login-register/domain. Set by bin/run-suite.
const specDir = process.env.SPEC_DIR
if (!specDir) {
  throw new Error('SPEC_DIR is not set, run the tests via `make test_<suite>`')
}

export default defineConfig({
  defaultCommandTimeout: 10_000,
  fixturesFolder: false,
  video: false,
  screenshotsFolder: 'cypress/results',
  downloadsFolder: 'cypress/downloads',
  viewportHeight: 768,
  viewportWidth: 1024,
  e2e: {
    specPattern: `${specDir}/*.spec.ts`,
    supportFile: '../cypress/support/e2e.ts',
  },
})
