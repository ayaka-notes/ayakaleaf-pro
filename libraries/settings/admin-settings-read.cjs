/*
 * Standalone child process spawned by ./admin-settings.js: reads the
 * stored site_settings document (site_settings collection, _id 'global')
 * from the site's MongoDB and prints it as JSON on stdout.
 *
 * Contract:
 *  - NEVER fails. Any error (no connection string, mongo unreachable,
 *    connection timeout, malformed document) results in "{}" on stdout
 *    and exit code 0. The parent degrades to env + defaults.
 *  - Test/dev seam: OVERLEAF_ADMIN_SETTINGS_FIXTURE points at a JSON
 *    file to read instead of MongoDB (unit tests, local probing).
 *  - OVERLEAF_ADMIN_SETTINGS_DB selects a non-default database name
 *    (tests); by default the database of the connection string is used.
 */
'use strict'

const CONNECT_TIMEOUT_MS = 4000

function finish(ok, text) {
  try {
    process.stdout.write(text)
  } catch (err) {
    /* the parent treats unreadable output as "no stored values" */
  }
  // always exit 0: the parent's catch path is for process-level
  // failures only (spawn error, timeout) — a failed READ must look
  // like an empty document, not an error.
  process.exit(ok ? 0 : 0)
}

async function main() {
  const fixture = process.env.OVERLEAF_ADMIN_SETTINGS_FIXTURE
  if (fixture) {
    const fs = require('node:fs')
    const text = fs.readFileSync(fixture, 'utf8')
    finish(true, JSON.stringify(JSON.parse(text) || {}))
    return
  }

  const url = process.env.OVERLEAF_MONGO_URL || process.env.MONGO_URL
  if (!url) {
    finish(false, '{}')
    return
  }

  const { MongoClient } = require('mongodb')
  const client = new MongoClient(url, { serverSelectionTimeoutMS: CONNECT_TIMEOUT_MS })
  try {
    await client.connect()
    const dbName = process.env.OVERLEAF_ADMIN_SETTINGS_DB || undefined
    const collection = (dbName ? client.db(dbName) : client.db()).collection('site_settings')
    const doc = await collection.findOne({ _id: 'global' })
    finish(true, JSON.stringify(doc || {}))
  } finally {
    await client.close().catch(() => {})
  }
}

main().catch(() => finish(false, '{}'))
