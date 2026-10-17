const Path = require('node:path')
const os = require('node:os')

const DAY_MS = 24 * 60 * 60 * 1000

module.exports = {
  internal: {
    clsiCache: {
      port: 3044,
      host: process.env.LISTEN_ADDRESS || '127.0.0.1',
    },
  },

  // Identity reported to web/clsi via the X-Shard/X-Zone headers. web resolves
  // the shard name back to an instance URL through CLSI_CACHE_INSTANCES, and
  // the frontend recognises cache urls by the "clsi-cache-" prefix
  // (see usesCache in frontend/js/features/pdf-preview/util/pdf-caching-transport.ts).
  shard: process.env.CLSI_CACHE_SHARD || `clsi-cache-${os.hostname()}`,
  zone: process.env.ZONE || 'local',

  // Base url used in the redirects sent to web/clsi. Defaults to the host the
  // request came in on, which is correct as long as they share the network.
  publicUrl: process.env.CLSI_CACHE_PUBLIC_URL,

  path: {
    cacheDir:
      process.env.CLSI_CACHE_DATA_PATH || Path.resolve(__dirname, '../cache'),
    // Compile output directory of a clsi running on the same host. When set,
    // outputs are hard-linked (or copied) from disk instead of being fetched
    // over http from the clsi download host.
    localClsiOutputDir: process.env.CLSI_CACHE_LOCAL_CLSI_OUTPUT_DIR,
  },

  persistor: {
    // s3 - Amazon S3, gcs - Google Cloud Storage, fs - local filesystem
    backend: process.env.CLSI_CACHE_BACKEND || 'fs',
    useSubdirectories: true,

    gcs: {
      endpoint: process.env.GCS_API_ENDPOINT
        ? {
            apiEndpoint: process.env.GCS_API_ENDPOINT,
            projectId: process.env.GCS_PROJECT_ID,
          }
        : undefined,
      unlockBeforeDelete: process.env.GCS_UNLOCK_BEFORE_DELETE === 'true',
      deletedBucketSuffix: process.env.GCS_DELETED_BUCKET_SUFFIX,
      deleteConcurrency: parseInt(process.env.GCS_DELETE_CONCURRENCY) || 50,
      signedUrlExpiryInMs: parseInt(process.env.LINK_EXPIRY_TIMEOUT || 60000),
    },

    s3: {
      key: process.env.AWS_ACCESS_KEY_ID,
      secret: process.env.AWS_SECRET_ACCESS_KEY,
      endpoint: process.env.AWS_S3_ENDPOINT,
      pathStyle: process.env.AWS_S3_PATH_STYLE,
      partSize: process.env.AWS_S3_PARTSIZE || 100 * 1024 * 1024,
      bucketCreds: process.env.S3_BUCKET_CREDENTIALS
        ? JSON.parse(process.env.S3_BUCKET_CREDENTIALS)
        : undefined,
    },
  },

  ingest: {
    concurrency: parseInt(process.env.CLSI_CACHE_INGEST_CONCURRENCY, 10) || 4,
    downloadTimeoutMs:
      parseInt(process.env.CLSI_CACHE_DOWNLOAD_TIMEOUT_MS, 10) || 30_000,
    // Keep in sync with MAX_ENTRIES_IN_OUTPUT_TAR in services/clsi/app/js/CLSICacheHandler.js
    maxTarEntries: 100,
    // web waits 30s for export-as-template, of which we may spend 15s waiting
    // for the outputs to arrive from clsi (see ClsiCacheHandler.exportSubmissionAsTemplate).
    exportWaitMs: 15_000,
  },

  expiry: {
    // Keep in sync with clsiCacheExpiryInSeconds in services/web/app/src/Features/Compile/ClsiManager.mjs
    buildAgeMs: parseInt(process.env.CLSI_CACHE_BUILD_EXPIRY_MS, 10) || 8 * DAY_MS,
    // clsi keeps CACHE_LIMIT=2 builds per project on its own disk, mirror that.
    maxBuildsPerProject:
      parseInt(process.env.CLSI_CACHE_MAX_BUILDS_PER_PROJECT, 10) || 2,
    sweepIntervalMs:
      parseInt(process.env.CLSI_CACHE_SWEEP_INTERVAL_MS, 10) || 10 * 60 * 1000,
  },
}
