import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    include: [
      'test/**/*.test.mjs',
      'test/**/*.test.ts',
      'deps/**/test/**/*.test.mjs',
    ],
    passWithNoTests: true,
  },
  resolve: {
    mainFields: ['module', 'main'],
    extensions: ['.ts', '.mjs', '.js', '.tsx', '.json'],
  },
})
