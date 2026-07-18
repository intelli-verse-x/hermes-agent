#!/usr/bin/env node
/**
 * IX Agency desktop dark mode eval (EVALS §13 D1–D6).
 * Writes `_docs/ORCH_IX_AGENCY_DARK_MODE_STATUS.md` and exits 1 on any FAIL.
 */
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const desktopRoot = path.resolve(here, '..')
const repoRoot = path.resolve(desktopRoot, '../../..')
const docsOut = path.join(repoRoot, '_docs/ORCH_IX_AGENCY_DARK_MODE_STATUS.md')
const localOut = path.join(here, 'ORCH_IX_AGENCY_DARK_MODE_STATUS.md')
const outPath =
  process.env.ORCH_IX_AGENCY_DARK_MODE_LOG ||
  (fs.existsSync(path.dirname(docsOut)) ? docsOut : localOut)
const ixDir = path.join(desktopRoot, 'src/app/ix-agency')
const contextTs = path.join(desktopRoot, 'src/themes/context.tsx')
const mainTs = path.join(desktopRoot, 'electron/main.ts')

const checks = []

function pass(id, detail) {
  checks.push({ id, ok: true, detail })
}

function fail(id, detail) {
  checks.push({ id, ok: false, detail })
}

// D5 — static grep: no hard-coded white page chrome in ix-agency workspace
const FORBIDDEN = /\b(bg-white|bg-gray-50|bg-slate-50|#ffffff|#fff\b|#FFFFFF)\b/
let d5Hits = []
try {
  for (const name of fs.readdirSync(ixDir)) {
    if (!/\.(tsx|ts|css)$/.test(name)) continue
    const file = path.join(ixDir, name)
    const text = fs.readFileSync(file, 'utf8')
    const lines = text.split('\n')
    lines.forEach((line, i) => {
      if (FORBIDDEN.test(line)) d5Hits.push(`${name}:${i + 1}: ${line.trim().slice(0, 120)}`)
    })
  }
  if (d5Hits.length === 0) pass('D5', 'no hard-coded light-only classes under ix-agency/')
  else fail('D5', d5Hits.slice(0, 8).join(' | '))
} catch (err) {
  fail('D5', `scan failed: ${err.message}`)
}

// D2 — source gate: Electron IX default themeSource is dark when unset
try {
  const main = fs.readFileSync(mainTs, 'utf8')
  const hasIxDarkDefault =
    /return IS_IX_AGENCY_BRAND \? 'dark' : 'system'/.test(main) ||
    /IS_IX_AGENCY_BRAND\s*\?\s*['"]dark['"]/.test(main)
  const hasSync =
    /setNativeTheme|hermes:native-theme|writePersistedThemeSource/.test(main)
  if (hasIxDarkDefault && hasSync) {
    pass('D2', 'readPersistedThemeSource defaults dark for IX; sync/persist present')
  } else {
    fail(
      'D2',
      `ixDarkDefault=${hasIxDarkDefault} sync=${hasSync}`
    )
  }
} catch (err) {
  fail('D2', err.message)
}

// D1 source presence (unit tests are authoritative)
try {
  const ctx = fs.readFileSync(contextTs, 'utf8')
  if (
    /DEFAULT_THEME_MODE/.test(ctx) &&
    /IS_IX_AGENCY_BRAND \? 'dark'/.test(ctx) &&
    /export const normalizeMode/.test(ctx)
  ) {
    pass('D1', 'DEFAULT_THEME_MODE / normalizeMode brand-dark present in context.tsx')
  } else {
    fail('D1', 'brand-dark default missing from context.tsx')
  }
} catch (err) {
  fail('D1', err.message)
}

// D3/D4/D6 — vitest
let vitestOk = false
let vitestOut = ''
try {
  vitestOut = execSync(
    'npx vitest run src/themes/ix-dark-mode.test.ts src/themes/profile-theme.test.ts',
    { cwd: desktopRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
  )
  vitestOk = true
} catch (err) {
  vitestOut = `${err.stdout || ''}\n${err.stderr || ''}\n${err.message}`
  vitestOk = false
}

if (vitestOk) {
  pass('D3', 'applyTheme dark → .dark + CSS vars (vitest)')
  pass('D4', 'applyTheme light → clears .dark (vitest)')
  pass('D6', 'normalizeMode + modePref unit tests green')
} else {
  fail('D3', 'vitest failed — see log')
  fail('D4', 'vitest failed — see log')
  fail('D6', vitestOut.split('\n').filter(Boolean).slice(-12).join(' | '))
}

const failed = checks.filter(c => !c.ok)
const passed = checks.filter(c => c.ok)
const when = new Date().toISOString()
const verdict = failed.length === 0 ? 'PASS' : 'FAIL'

const lines = [
  `# ORCH IX Agency Dark Mode — ${verdict}`,
  '',
  `- **When:** ${when}`,
  `- **Desktop:** \`${desktopRoot}\``,
  `- **Score:** pass=${passed.length} fail=${failed.length}`,
  `- **Gate:** EVALS §13 — any ❌ → not done`,
  '',
  '## Checks',
  ...checks.map(c => `- ${c.ok ? '✅' : '❌'} ${c.id} — ${c.detail}`),
  '',
  '## Vitest (tail)',
  '```',
  ...(vitestOut || '(no output)').split('\n').slice(-40),
  '```',
  ''
]

fs.mkdirSync(path.dirname(outPath), { recursive: true })
fs.writeFileSync(outPath, lines.join('\n'), 'utf8')
console.log(lines.join('\n'))
process.exit(failed.length === 0 ? 0 : 1)
