#!/usr/bin/env node
// set-exe-identity.mjs — stamp the Hermes icon + version metadata onto the
// built desktop executable using rcedit before electron-builder signs it.
//
// WHY THIS EXISTS
// ---------------
// This explicit stamp keeps product metadata deterministic across package
// targets. Public Windows release now requires electron-builder's
// Authenticode path; CI rejects missing or invalid signatures.
//
// HOW IT RUNS
// -----------
// Primarily as an electron-builder `afterPack` hook (scripts/after-pack.mjs),
// so EVERY packed build — first install, `hermes desktop`, the installer's
// --update rebuild, or a dev's manual `npm run pack` — gets a branded exe from
// one place. Previously this stamp lived only in install.ps1, so the update
// path (which rebuilds via `hermes desktop --build-only`, never install.ps1)
// shipped a stock "Electron" exe. Keeping it in afterPack closes that gap.
//
// Also runnable standalone for ad-hoc re-stamping:
//   node scripts/set-exe-identity.mjs <path-to-Hermes.exe>
//
// Exits 0 on success, non-zero on failure when run as a CLI. As a hook,
// stampExeIdentity() resolves on success and rejects on failure; the caller
// (after-pack.mjs) swallows the rejection so a stamp failure never fails an
// otherwise-good build (worst case: stock icon, not a broken app).

import { resolve, join } from 'node:path'
import { existsSync } from 'node:fs'

import { rcedit } from 'rcedit'

import { loadBrand } from './apply-brand.mjs'
import { isMain } from './utils.mjs'

// Stamp the active brand's icon + identity onto `exe`. Resolves on success,
// throws on failure. `desktopRoot` defaults to this script's package root so
// the icon and the rcedit dependency resolve regardless of cwd.
async function stampExeIdentity(exe, desktopRoot = resolve(import.meta.dirname, '..')) {
  if (!exe || !existsSync(exe)) {
    throw new Error(`target exe not found: ${exe}`)
  }

  const brand = loadBrand()

  // Brand .ico with a fallback to the default icon so a brand shipping only a
  // .png still gets a stamped (if generic) identity instead of a hard failure.
  let icon = join(desktopRoot, brand.iconIco)
  if (!existsSync(icon)) {
    icon = join(desktopRoot, 'assets', 'icon.ico')
  }
  if (!existsSync(icon)) {
    throw new Error(`icon not found: ${icon}`)
  }

  console.log(`[set-exe-identity] stamping ${exe} (brand: ${brand.id})`)
  console.log(`[set-exe-identity] icon: ${icon}`)

  await rcedit(exe, {
    icon,
    'version-string': {
      ProductName: brand.productName,
      FileDescription: brand.productName,
      CompanyName: brand.author,
      LegalCopyright: `Copyright (c) 2026 ${brand.author}`
    }
  })

  console.log(`[set-exe-identity] done — ${brand.productName} icon + identity stamped`)
}

export { stampExeIdentity }

// CLI entry point: `node scripts/set-exe-identity.mjs <exe>`.
if (isMain(import.meta.url)) {
  const exe = process.argv[2]
  if (!exe) {
    console.error('[set-exe-identity] usage: set-exe-identity.mjs <path-to-exe>')
    process.exit(2)
  }
  stampExeIdentity(exe).catch(err => {
    console.error(`[set-exe-identity] ${err.message}`)
    process.exit(1)
  })
}
