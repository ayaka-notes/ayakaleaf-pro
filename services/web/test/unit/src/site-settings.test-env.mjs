/**
 * MUST be the first import of site-settings.test.mjs (before the manager,
 * which evaluates @overleaf/settings at import time).
 *
 * Points MONGO_URL at a NON-sharelatex database, so:
 * - the manager's live-DB tripwire never fires (the live `sharelatex`
 *   database can neither be read nor written by a test);
 * - every read simply finds "no stored document" — the env + defaults
 *   layer these tests pin down; accidental writes land in this
 *   throwaway database, never in live site state.
 *
 * The local deployment does not publish mongo on 127.0.0.1, so resolve
 * the container's bridge IP via docker when available. Without docker
 * (or without mongo) the manager degrades fail-soft to exactly the same
 * "no stored document" state.
 */
import { execSync } from 'node:child_process'

if (!process.env.MONGO_URL) {
  // directConnection=true: pin the driver to this single server. Without
  // it, the local deployment's mongo advertises its in-network hostname
  // in the topology, the driver re-seeds to it and the connection fails
  // from the host.
  const db = 'overleaf-site-settings-test'
  let url = `mongodb://127.0.0.1:27017/${db}?directConnection=true`
  try {
    const ip = execSync(
      'docker inspect mongo --format "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}"',
      { timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }
    )
      .toString()
      .trim()
    if (ip) url = `mongodb://${ip}:27017/${db}?directConnection=true`
  } catch {
    /* no docker/mongo: dead URL, the manager degrades fail-soft */
  }
  process.env.MONGO_URL = url
}
