#!/usr/bin/env node
// check-brand-separation.mjs — assert a built desktop bundle contains ONLY
// the active brand's workspace.
//
// Strict brand separation is a release requirement: an IX Agency build must
// ship no QuizVerse rail item / route / workspace chunk, and vice versa. The
// renderer achieves that with compile-time brand constants (VITE_DESKTOP_BRAND
// define → dead-code-eliminated lazy imports); this script proves it on the
// actual build output, so a regression in the gating (or in the bundler's
// DCE) fails CI instead of shipping a cross-brand binary.
//
// Run AFTER `npm run build` for the brand under test:
//   DESKTOP_BRAND=quizverse npm run build
//   DESKTOP_BRAND=quizverse node scripts/check-brand-separation.mjs
//
// Checks:
//   1. build/brand.json matches the resolved DESKTOP_BRAND.
//   2. build/electron-builder-brand.json carries the brand identity
//      (appId, productName, artifact prefix, linux executable, S3 path).
//   3. dist/assets/*.js (the renderer chunks) contain the brand's own
//      workspace markers and NONE of the other brand's markers, and no chunk
//      file is named after the other brand's workspace.
//   4. The retired dist/qv-webview-preload.js is absent for every brand.
//   5. dist/electron-main.mjs + dist/electron-preload.js (the Electron main
//      and preload bundles) contain the brand's own IPC surface and NONE of
//      the other brand's markers — IPC channel prefixes, brand-only URLs and
//      module symbols. This proves the brand-gates DCE (brand-gates.ts +
//      minifySyntax in bundle-electron-main.mjs) actually stripped the
//      inactive brand's main-process/preload code, including the preload's
//      exposed window.hermesDesktop namespace.

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { resolveBrandId } from './apply-brand.mjs'

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const brandId = resolveBrandId()

// Marker strings that exist ONLY inside each brand's renderer workspace
// sources (src/app/ix-agency/, src/app/quizverse/). If you rename these in
// the workspace code, update them here — the "own markers present" assertion
// below catches a silent drift that would make this check vacuous.
const WORKSPACE_MARKERS = {
  'ix-agency': ['Search invoices', 'Org skills'],
  quizverse: ['persist:quizverse-tutor', 'persist:quizverse-web', 'TutorX']
}

// Markers for the Electron main bundle: the brand's IPC channel prefix plus
// strings that exist only in that brand's main-process estate (IX portal/VPN,
// QuizVerse DeepTutor supervisor). The channel prefix doubles as the "own
// marker" for both main and preload.
const MAIN_MARKERS = {
  'ix-agency': ['hermes:ix-agency:', 'persist:ix-agency-portal', 'wg-quick'],
  quizverse: ['hermes:quizverse:', 'tutor.intelli-verse-x.ai', 'DeepTutorSupervisor', 'persist:quizverse-tutor']
}

const IPC_PREFIX = {
  'ix-agency': 'hermes:ix-agency:',
  quizverse: 'hermes:quizverse:'
}

const failures = []

function fail(message) {
  failures.push(message)
  console.error(`  ✗ ${message}`)
}

function ok(message) {
  console.log(`  ✓ ${message}`)
}

console.log(`[check-brand-separation] brand: ${brandId}`)

const packageJson = JSON.parse(fs.readFileSync(path.join(desktopRoot, 'package.json'), 'utf8'))

if (packageJson.name === '@intelliverse-x/desktop') {
  ok(`source package identity = ${packageJson.name}`)
} else {
  fail(`source package identity is "${packageJson.name}", expected "@intelliverse-x/desktop"`)
}

// ── 1. build/brand.json ─────────────────────────────────────────────────────
const brandJsonPath = path.join(desktopRoot, 'build', 'brand.json')
let brand = null

try {
  brand = JSON.parse(fs.readFileSync(brandJsonPath, 'utf8'))
} catch {
  fail(`build/brand.json missing or unreadable — run the build first (${brandJsonPath})`)
}

if (brand) {
  if (brand.id === brandId) {
    ok(`build/brand.json is ${brand.id} (${brand.productName})`)
  } else {
    fail(`build/brand.json is "${brand.id}" but DESKTOP_BRAND resolved to "${brandId}" — stale build/`)
  }
}

// ── 2. electron-builder overlay ─────────────────────────────────────────────
const builderConfigPath = path.join(desktopRoot, 'build', 'electron-builder-brand.json')

if (brand && fs.existsSync(builderConfigPath)) {
  const config = JSON.parse(fs.readFileSync(builderConfigPath, 'utf8'))
  const expectations = [
    ['appId', config.appId, brand.appId],
    ['productName', config.productName, brand.productName],
    ['copyright', config.copyright, brand.copyright],
    ['artifactName', config.artifactName, `${brand.artifactPrefix}-\${version}-\${os}-\${arch}.\${ext}`],
    ['protocol', config.protocols?.[0]?.schemes?.[0], brand.protocolScheme],
    ['icon', config.icon, brand.icon],
    ['linux.executableName', config.linux?.executableName, brand.executableName],
    ['publish[s3].path', (config.publish || []).find(p => p?.provider === 's3')?.path, brand.s3PublishPath]
  ]

  for (const [label, actual, expected] of expectations) {
    if (actual === expected) {
      ok(`builder config ${label} = ${actual}`)
    } else {
      fail(`builder config ${label} is "${actual}", expected "${expected}"`)
    }
  }

  for (const asset of [brand.icon, brand.iconIco]) {
    const candidates = asset.endsWith('.ico') ? [asset] : [`${asset}.icns`, `${asset}.ico`, `${asset}.png`]

    if (candidates.some(candidate => fs.existsSync(path.join(desktopRoot, candidate)))) {
      ok(`brand asset exists for ${asset}`)
    } else {
      fail(`brand asset missing for ${asset} (checked ${candidates.join(', ')})`)
    }
  }

  const canonicalIcon = path.join(desktopRoot, `${brand.icon}.png`)

  if (!fs.existsSync(canonicalIcon)) {
    fail(`canonical brand icon missing: ${canonicalIcon}`)
  } else {
    const digest = crypto.createHash('sha256').update(fs.readFileSync(canonicalIcon)).digest('hex')

    if (digest === brand.iconSha256) {
      ok(`canonical icon digest = ${digest}`)
    } else {
      fail(`canonical icon digest is ${digest}, expected ${brand.iconSha256}`)
    }
  }
} else if (brand) {
  fail(`build/electron-builder-brand.json missing (${builderConfigPath})`)
}

// ── 3. renderer chunks ──────────────────────────────────────────────────────
const assetsDir = path.join(desktopRoot, 'dist', 'assets')
const otherBrand = brandId === 'quizverse' ? 'ix-agency' : 'quizverse'

if (!fs.existsSync(assetsDir)) {
  fail(`dist/assets missing — run \`DESKTOP_BRAND=${brandId} npm run build\` first`)
} else {
  const chunkFiles = fs.readdirSync(assetsDir).filter(name => name.endsWith('.js'))
  const chunkText = chunkFiles.map(name => fs.readFileSync(path.join(assetsDir, name), 'utf8')).join('\n')

  // No chunk named after the other brand's workspace (lazy imports produce
  // chunks named for their module — e.g. quizverse-<hash>.js).
  const foreignChunks = chunkFiles.filter(name => name.includes(otherBrand === 'ix-agency' ? 'ix-agency' : 'quizverse'))

  if (foreignChunks.length === 0) {
    ok(`no ${otherBrand} workspace chunk among ${chunkFiles.length} renderer chunks`)
  } else {
    fail(`${otherBrand} workspace chunk(s) present: ${foreignChunks.join(', ')}`)
  }

  // The other brand's workspace code must not appear anywhere in the bundle.
  for (const marker of WORKSPACE_MARKERS[otherBrand]) {
    if (chunkText.includes(marker)) {
      fail(`renderer bundle leaks ${otherBrand} marker "${marker}"`)
    } else {
      ok(`no ${otherBrand} marker "${marker}"`)
    }
  }

  // Sanity: this brand's own markers must be present, or the markers have
  // drifted and the leak assertions above prove nothing.
  const ownPresent = WORKSPACE_MARKERS[brandId].filter(marker => chunkText.includes(marker))

  if (ownPresent.length > 0) {
    ok(`own workspace markers present (${ownPresent.length}/${WORKSPACE_MARKERS[brandId].length})`)
  } else {
    fail(`none of the ${brandId} workspace markers found — markers drifted or the workspace was dropped`)
  }

  // The other brand's PRODUCT NAME must not appear anywhere in the renderer
  // bundle: hardcoded product-name copy is exactly the leak class the round-2
  // audit found (chat headlines, error toasts, settings help text). Legitimate
  // occurrences, if one ever exists, go in the allowlist as the full containing
  // string; those occurrences are subtracted before the assertion.
  const PRODUCT_NAME_ALLOWLIST = {
    'ix-agency': [], // strings allowed to mention "QuizVerse" in an IX build
    quizverse: [] // strings allowed to mention "IX Agency" in a QuizVerse build
  }

  const otherManifest = JSON.parse(fs.readFileSync(path.join(desktopRoot, 'brands', `${otherBrand}.json`), 'utf8'))
  const countOccurrences = (haystack, needle) => haystack.split(needle).length - 1

  // IX Agency admin skills and connector pickers legitimately name managed apps
  // (QuizVerse, QuestX, …). Only the QuizVerse build must not leak IX Agency
  // product-name copy into shared UI.
  if (brandId === 'ix-agency') {
    ok(`skipped "${otherManifest.productName}" product-name scan — IX admin surfaces reference managed apps`)
  } else {
    let productNameHits = countOccurrences(chunkText, otherManifest.productName)

    for (const allowedString of PRODUCT_NAME_ALLOWLIST[brandId]) {
      productNameHits -=
        countOccurrences(chunkText, allowedString) * countOccurrences(allowedString, otherManifest.productName)
    }

    if (productNameHits === 0) {
      ok(`no "${otherManifest.productName}" product-name occurrences in the renderer bundle`)
    } else {
      fail(`renderer bundle contains "${otherManifest.productName}" ${productNameHits} time(s) outside the allowlist`)
    }
  }
}

// ── 4. Electron main + preload bundles ──────────────────────────────────────
const ELECTRON_BUNDLES = [
  { file: 'electron-main.mjs', markers: MAIN_MARKERS },
  // The preload only carries IPC channel strings — no supervisor/VPN symbols.
  {
    file: 'electron-preload.js',
    markers: { 'ix-agency': [IPC_PREFIX['ix-agency']], quizverse: [IPC_PREFIX.quizverse] }
  }
]

for (const { file, markers } of ELECTRON_BUNDLES) {
  const bundlePath = path.join(desktopRoot, 'dist', file)

  if (!fs.existsSync(bundlePath)) {
    fail(`dist/${file} missing — run \`DESKTOP_BRAND=${brandId} npm run build\` first`)
    continue
  }

  const text = fs.readFileSync(bundlePath, 'utf8')

  for (const marker of markers[otherBrand]) {
    if (text.includes(marker)) {
      fail(`dist/${file} leaks ${otherBrand} marker "${marker}" — brand-gates DCE regressed`)
    } else {
      ok(`dist/${file}: no ${otherBrand} marker "${marker}"`)
    }
  }

  // Sanity: this brand's own IPC surface must be present, or the markers have
  // drifted and the leak assertions above prove nothing.
  if (text.includes(IPC_PREFIX[brandId])) {
    ok(`dist/${file}: own IPC surface (${IPC_PREFIX[brandId]}*) present`)
  } else {
    fail(
      `dist/${file}: own IPC surface (${IPC_PREFIX[brandId]}*) missing — markers drifted or the brand surface was dropped`
    )
  }
}

// ── 5. retired electron artifacts ───────────────────────────────────────────
const qvPreload = path.join(desktopRoot, 'dist', 'qv-webview-preload.js')
const qvPreloadExists = fs.existsSync(qvPreload)

if (!qvPreloadExists) {
  ok(`dist/qv-webview-preload.js absent — obsolete webview bridge removed for ${brandId}`)
} else {
  fail(`dist/qv-webview-preload.js present in a ${brandId} build`)
}

if (failures.length > 0) {
  console.error(`[check-brand-separation] FAILED — ${failures.length} problem(s)`)
  process.exit(1)
}

console.log(`[check-brand-separation] OK — ${brandId} build is cleanly separated`)
