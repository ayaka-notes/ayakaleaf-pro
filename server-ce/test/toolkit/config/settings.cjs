module.exports = {
  ...require('/etc/overleaf/settings.js'),
  disableRateLimits: process.env.E2E_DISABLE_RATE_LIMITS !== 'false',
}
