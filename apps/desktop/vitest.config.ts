import type { TestProjectConfiguration } from 'vitest/config';
import { defineConfig } from 'vitest/config'

const reactUi: TestProjectConfiguration = {
  extends: './vite.config.ts',
  test: {
    name: 'ui',
    environment: 'jsdom',
    // vitest.setup.ts configures testing-library; src/test/setup.ts polyfills
    // CSS.escape for jsdom (timeline/cron selectors).
    setupFiles: ['./vitest.setup.ts', './src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    globals: true,
    // The first test in each file pays jsdom env init + full module transform,
    // which can exceed vitest's 5000ms default under CI/load. 15s gives the
    // cold start headroom without masking genuinely hung tests.
    testTimeout: 15_000
  }
}

const electronNative: TestProjectConfiguration = {
  test: {
    name: 'electron',
    environment: 'node',
    include: ['electron/**/*.test.ts', 'scripts/**.test.{ts,mjs}'],
    // Fork-specific electron suites (IX Agency / QuizVerse / local AI / governed
    // voice) are node:test files run via `tsx --test` — see the
    // test:desktop:platforms / test:local-ai / test:governed-voice scripts.
    // vitest reports "No test suite found" on them, so keep them out of this
    // project.
    exclude: [
      '**/node_modules/**',
      'electron/ix-*.test.ts',
      'electron/qv-*.test.ts',
      'electron/local-ai*.test.ts',
      'electron/local-ai/**',
      'electron/adaptive-routing/**',
      'electron/mic-permissions.test.ts',
      'electron/studio-manager.test.ts',
      'electron/voice-integration-contract.test.ts'
    ]
  }
}

export default defineConfig({
  test: {
    projects: [reactUi, electronNative]
  }
})
