// Settings are read once on import, so the test environment has to be in
// place before any module of the service is loaded.
import fs from 'node:fs'
import os from 'node:os'
import Path from 'node:path'

const root = fs.mkdtempSync(Path.join(os.tmpdir(), 'clsi-cache-test-'))
process.env.CLSI_CACHE_DATA_PATH = Path.join(root, 'cache')
process.env.CLSI_CACHE_LOCAL_CLSI_OUTPUT_DIR = Path.join(root, 'clsi-output')
process.env.CLSI_CACHE_SHARD = 'clsi-cache-test'
process.env.CLSI_CACHE_SWEEP_INTERVAL_MS = '0'
process.env.LOG_LEVEL = 'fatal'

fs.mkdirSync(process.env.CLSI_CACHE_DATA_PATH, { recursive: true })
fs.mkdirSync(process.env.CLSI_CACHE_LOCAL_CLSI_OUTPUT_DIR, { recursive: true })

process.on('exit', () => {
  fs.rmSync(root, { recursive: true, force: true })
})
