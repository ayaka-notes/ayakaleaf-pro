module.exports = {
  internal: {
    thirdPartyDataStore: {
      port: 3002,
      host: process.env.LISTEN_ADDRESS || '127.0.0.1',
    },
  },

  apis: {
    // private API of web, for the Dropbox → Overleaf direction
    web: {
      url: `http://${
        process.env.WEB_API_HOST || process.env.WEB_HOST || '127.0.0.1'
      }:${process.env.WEB_PORT || 3000}`,
      user: process.env.WEB_API_USER || 'overleaf',
      pass: process.env.WEB_API_PASSWORD || 'password',
    },
    // tells a user why their Dropbox was unlinked, in the project list
    notifications: {
      url: `http://${process.env.NOTIFICATIONS_HOST || '127.0.0.1'}:3042`,
    },
  },

  mongo: {
    url:
      process.env.MONGO_CONNECTION_STRING ||
      process.env.MONGO_URL ||
      `mongodb://${process.env.MONGO_HOST || '127.0.0.1'}/sharelatex`,
  },

  redis: {
    tpds: {
      host: process.env.REDIS_HOST || '127.0.0.1',
      port: process.env.REDIS_PORT || '6379',
      password: process.env.REDIS_PASSWORD || '',
    },
  },

  dropbox: {
    appKey: process.env.DROPBOX_APP_KEY,
    appSecret: process.env.DROPBOX_APP_SECRET,
    // API domain for the dropbox SDK, for testing against a mock only
    domain: process.env.DROPBOX_API_DOMAIN || undefined,
    proxyUrl: process.env.DROPBOX_SYNC_PROXY_URL || undefined,
    // same cipher as the web module, which writes the token
    tokenCipherLabel: process.env.DROPBOX_TOKEN_CIPHER_LABEL || '2026.3-v3',
    tokenCipherPassword: process.env.DROPBOX_TOKEN_CIPHER_PASSWORD,
  },

  // the largest file web takes, read as web reads it
  maxUploadSize: parseInt(process.env.MAX_UPLOAD_SIZE || '50', 10) * 1024 * 1024,

  queue: {
    // users drained in parallel by the worker
    concurrency: parseInt(process.env.TPDS_QUEUE_CONCURRENCY, 10) || 4,
    pollIntervalMs: 1000,
    maxAttempts: 5,
  },
}
