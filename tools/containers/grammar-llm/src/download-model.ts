// One-shot model downloader (start.sh calls this before the server boots).
// Uses node-llama-cpp's createModelDownloader (same API the desktop app's
// modelManager.ts adapter uses against v3.19:
//   await createModelDownloader({ modelUri, dirPath, fileName, onProgress })
//   → { download(): Promise, cancel(): Promise }
//   onProgress(status: { downloadedSize, totalSize, ... })
//
// Usage:
//   node dist/download-model.mjs --url <url> --out /models/GRMR-V3-G4B-Q4_K_M.gguf
//   node dist/download-model.mjs --url <url> --dir /models --file name.gguf

import fs from 'node:fs';
import path from 'node:path';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  return process.argv[i + 1];
}

function die(msg: string): never {
  console.error(`ERROR: ${msg}`);
  process.exit(2);
}

const url = arg('url');
const out = arg('out');
const dir = arg('dir');
const file = arg('file');

if (!url) die('--url is required');
if (!out && !(dir && file)) die('either --out or both --dir and --file are required');

const outPath = out ?? path.join(dir as string, file as string);
fs.mkdirSync(path.dirname(outPath), { recursive: true });

const existing = fs.existsSync(outPath) ? fs.statSync(outPath).size : 0;
if (existing > 0) {
  console.log(`Model already present (${(existing / 1024 / 1024).toFixed(0)} MB): ${outPath}`);
  process.exit(0);
}

console.log(`Downloading model…`);
console.log(`  url:   ${url}`);
console.log(`  target: ${outPath}`);

const { createModelDownloader } = await import('node-llama-cpp');

let lastLog = 0;
let lastPct = -1;
const downloader = await createModelDownloader({
  modelUri: url,
  dirPath: path.dirname(outPath),
  fileName: path.basename(outPath),
  onProgress: (status: { downloadedSize: number; totalSize: number }) => {
    const now = Date.now();
    const pct = status.totalSize > 0 ? Math.floor((status.downloadedSize / status.totalSize) * 100) : 0;
    if (now - lastLog > 1000 || pct !== lastPct) {
      lastLog = now;
      lastPct = pct;
      const mb = (status.downloadedSize / 1024 / 1024).toFixed(1);
      const tot = status.totalSize > 0 ? ` / ${(status.totalSize / 1024 / 1024).toFixed(0)} MB` : '';
      process.stdout.write(`\r  ${pct}% ${mb} MB${tot}   `);
    }
  },
});

try {
  await downloader.download();
  console.log('');
  const size = fs.statSync(outPath).size;
  console.log(`Model downloaded: ${outPath} (${(size / 1024 / 1024).toFixed(0)} MB)`);
} catch (err) {
  console.error('');
  console.error(`Model download failed: ${String(err)}`);
  process.exit(1);
}
