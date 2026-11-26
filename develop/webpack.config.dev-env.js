const { merge } = require('webpack-merge')

const base = require('./webpack.config.dev')

module.exports = merge(base, {
  devServer: {
    allowedHosts: 'all',
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
        context: '/simplesaml/**',
        target: 'http://saml:4000',
      },
      {
        context: '/grafana',
        target: 'http://grafana:3000',
        ws: true,
      },
      {
        context: '/mailpit',
        target: 'http://mailpit:8025',
        ws: true,
      },
      {
        context: '/mongo-express',
        target: 'http://mongo-express:8081',
      },
      {
        context: '/redis-insight',
        target: 'http://redis-insight:5540',
        ws: true,
      },
      {
        context: ['!**/*.js', '!**/*.css', '!**/*.json'],
        target: 'http://web:3000',
      },
    ],
  },
})
