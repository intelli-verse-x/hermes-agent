#!/usr/bin/env node
// sync-gbrain-packs.mjs — copy `_brain/apps/<slug>/AGENTS.md` into the
// desktop brand brain packs (keeps App-ID gBrain source of truth in gBrain).
//
// Usage (from monorepo or hermes-agent checkout):
//   node apps/desktop/scripts/sync-gbrain-packs.mjs
//   BRAIN_ROOT=/path/to/_brain node apps/desktop/scripts/sync-gbrain-packs.mjs

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const desktopRoot = path.resolve(here, '..')

const BRANDS = [
  { id: 'ix-agency', appId: 'ai.intelli-verse-x.ix-agency' },
  { id: 'quizverse', appId: 'ai.intelli-verse-x.quizverse' }
]

function resolveBrainRoot() {
  if (process.env.BRAIN_ROOT) {return path.resolve(process.env.BRAIN_ROOT)}

  const candidates = [
    path.resolve(desktopRoot, '../../../../_brain'),
    path.resolve(desktopRoot, '../../../_brain'),
    path.resolve(process.cwd(), '_brain')
  ]

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'apps'))) {return candidate}
  }

  throw new Error('Could not find _brain/ — set BRAIN_ROOT')
}

function appendCompanyPointer(body, brandId) {
  if (body.includes('## Company gBrain (pointer)')) {return body}

  return `${body.trimEnd()}

## Company gBrain (pointer)

Company knowledge lives in the monorepo \`_brain/\` (ORG_CHART, APP_ID_REGISTRY, verticals, decisions). This desktop pack is the **App-ID slice** for \`${brandId}\` — keep answers scoped here unless the user asks for cross-product orchestration.
`
}

const brainRoot = resolveBrainRoot()

for (const brand of BRANDS) {
  const source = path.join(brainRoot, 'apps', brand.id, 'AGENTS.md')
  const destDir = path.join(desktopRoot, 'brands', `${brand.id}-brain`)
  const dest = path.join(destDir, 'AGENTS.md')

  if (!fs.existsSync(source)) {
    console.warn(`[sync-gbrain] skip ${brand.id}: missing ${source}`)
    continue
  }

  fs.mkdirSync(destDir, { recursive: true })
  const body = appendCompanyPointer(fs.readFileSync(source, 'utf8'), brand.id)
  fs.writeFileSync(dest, body.endsWith('\n') ? body : `${body}\n`, 'utf8')
  console.log(`[sync-gbrain] ${brand.id} (${brand.appId}) → brands/${brand.id}-brain/AGENTS.md`)
}
