#!/usr/bin/env node
// bundle-electron-main.mjs — bundles electron/main.ts and electron/preload.ts
// into self-contained js files in dist/ so the packaged app doesn't need
// node_modules/ or tsx at runtime.
//
// Output:
//   dist/electron-main.mjs    (MJS bundle — entry point for packaged app)
//   dist/electron-preload.js (CJS bundle — loaded via BrowserWindow preload)
//
// `electron` and `node-pty` are external (provided by the runtime / staged
// separately via stage-native-deps).
import { build } from 'esbuild'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdirSync } from 'node:fs'

import { resolveBrandId } from './apply-brand.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const distDir = resolve(root, 'dist')
mkdirSync(distDir, { recursive: true })

// Bake the build flavor into the bundle so a packaged app can never follow
// the wrong brand (electron/brand.ts selects its manifest off this define).
const brandId = resolveBrandId()

const mainEntry = resolve(root, 'electron/main.ts')
const mainOut = resolve(distDir, 'electron-main.mjs')
const preloadEntry = resolve(root, 'electron/preload.ts')
const preloadOut = resolve(distDir, 'electron-preload.js')

const external = ['electron', 'node-pty', 'fs']
// Production bundles bake packaged=true so unpackaged `electron .` still
// behaves like a packaged build. Dev bundles (`--dev`) leave the env alone
// so HERMES_DESKTOP_DEV_SERVER / source-tree resolution keep working.
const isDev = process.argv.includes('--dev')
const define = {
  'process.env.HERMES_DESKTOP_BRAND': JSON.stringify(brandId),
  ...(isDev ? {} : { 'process.env.HERMES_DESKTOP_IS_PACKAGED': JSON.stringify(true) })
}

// minifySyntax (NOT identifiers/whitespace — the bundle stays debuggable) is
// what lets esbuild propagate the brand define across modules: brand.ts's
// IS_QUIZVERSE_BRAND / IS_IX_AGENCY_BRAND constant-fold to literals, the
// `if (IS_*)` registration blocks in main.ts / preload.ts collapse, and the
// inactive brand's modules (qv-deeptutor, ix-* IPC, its manifest JSON) are
// tree-shaken out of the bundle. check-brand-separation.mjs asserts the
// result on dist/electron-main.mjs + dist/electron-preload.js.
const sharedBuildOptions = { minifySyntax: true }

// Bundle main.ts → dist/electron-main.mjs
await build({
  entryPoints: [mainEntry],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: mainOut,
  external,
  banner: {
    js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
  },
  define,
  ...sharedBuildOptions,
  logLevel: 'info',
})
console.log(`bundled ${mainOut}${isDev ? ' (dev)' : ''}`)

// Bundle preload.ts → dist/electron-preload.js
await build({
  entryPoints: [preloadEntry],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  outfile: preloadOut,
  external,
  define,
  ...sharedBuildOptions,
  logLevel: 'info',
})
console.log(`bundled ${preloadOut}${isDev ? ' (dev)' : ''}`)

// Remove the retired guest webview preload from old/incremental builds.
const qvWebviewPreloadOut = resolve(distDir, 'qv-webview-preload.js')
try {
  const { unlinkSync } = await import('node:fs')
  unlinkSync(qvWebviewPreloadOut)
} catch {
  // absent — already clean
}
