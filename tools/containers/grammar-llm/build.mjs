// Build: bundle the TypeScript server + vendored core into self-contained
// ES modules under dist/. node-llama-cpp stays external (native, platform
// packages installed by npm at install time).

import { build } from 'esbuild';

const quiet = process.argv.includes('--quiet');

await build({
  entryPoints: ['src/server.ts', 'src/download-model.ts', 'src/languagetool.ts', 'src/config.ts'],
  outdir: 'dist',
  outExtension: { '.js': '.mjs' },
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  // Native module: keep as a runtime import; npm installs the right
  // @node-llama-cpp/* prebuilt for the target platform.
  external: ['node-llama-cpp'],
  sourcemap: false,
  minify: false,
  logLevel: quiet ? 'warning' : 'info',
});

if (!quiet) console.log('✓ build complete → dist/ (server.mjs, download-model.mjs, languagetool.mjs, config.mjs)');
