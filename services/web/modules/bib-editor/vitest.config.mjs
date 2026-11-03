import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  // same JSX runtime as the app's webpack build (components don't import React)
  esbuild: { jsx: 'automatic' },
  test: {
    globals: true,
    environment: 'jsdom',
    include: [
      'test/**/*.test.mjs',
      'test/**/*.test.ts',
      'test/**/*.test.tsx',
      'deps/**/test/**/*.test.mjs',
      'deps/**/test/**/*.test.tsx',
    ],
    passWithNoTests: true,
  },
  resolve: {
    // shared frontend imports (the modal uses '@/shared/...' — webpack alias
    // points '@/...' at frontend/js in this app)
    alias: {
      '@': fileURLToPath(new URL('../../frontend/js/', import.meta.url)),
    },
    mainFields: ['module', 'main'],
    extensions: ['.ts', '.mjs', '.js', '.tsx', '.json'],
  },
})
