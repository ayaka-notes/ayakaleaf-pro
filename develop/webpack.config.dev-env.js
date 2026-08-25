const { merge } = require('webpack-merge')

const base = require('./webpack.config.dev')

module.exports = merge(base, {
  devServer: {
    allowedHosts: 'auto',
    devMiddleware: {
      index: false,
    },
    proxy: [
      {
        context: '/socket.io/**',
        target: 'http://real-time:3026',
        ws: true,
      },
      {
        context: '/git/**',
        target: 'http://git-bridge:8000',
        pathRewrite: { '^/git': '' }
      },
      {
        // The clsi-cache lookup ends with .json and would otherwise be
        // swallowed by the static-asset exclusion below.
        context: '/project/**/output/cached/**',
        target: 'http://web:3000',
      },
      {
        context: ['!**/*.js', '!**/*.css', '!**/*.json'],
        target: 'http://web:3000',
      },
    ],
  },
})
