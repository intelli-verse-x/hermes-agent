import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const setup = fs.readFileSync(path.join(desktopRoot, 'src', 'components', 'local-ai-setup-overlay.tsx'), 'utf8')
const settings = fs.readFileSync(path.join(desktopRoot, 'src', 'app', 'settings', 'local-ai-settings.tsx'), 'utf8')

test('guided setup exposes detailed candidate attempt progress', () => {
  assert.match(setup, /Attempt \{progress\.attemptIndex\} of \{progress\.attemptTotal\}/)
  assert.match(setup, /progress\.attemptModel/)
  assert.match(setup, /runtime repair/)
  assert.match(setup, /role="progressbar"/)
})

test('readiness check icon is gated by verified completion', () => {
  assert.match(setup, /data-readiness-verified=\{completed \? 'true' : 'false'\}/)
  assert.match(setup, /\{completed \? \(\s*<CheckCircle2/)
  assert.match(setup, /progress\?\.stage === 'complete' \|\| \(!progress && state\.status\?\.runtime\.state === 'ready'\)/)
})

test('settings visibly distinguish smart local and cloud fallback usage', () => {
  assert.match(settings, /title="Smart route"/)
  assert.match(settings, /status\.routeStatus\.localReady/)
  assert.match(settings, /status\.routeStatus\.cloudFallbacks/)
  assert.match(settings, /cloud tokens avoided/i)
  assert.match(settings, /Estimated cloud tokens avoided/)
  assert.match(settings, /status\?\.measuredLocalTokens/)
  assert.match(settings, /status\?\.tokenBaseline/)
  assert.match(settings, /status\?\.tokenSavingsPeriodStartedAt/)
})

test('setup dialog manages initial focus, Escape, focus trap, and focus return', () => {
  assert.match(setup, /aria-modal="true"/)
  assert.match(setup, /aria-labelledby="local-ai-setup-title"/)
  assert.match(setup, /titleRef\.current\?\.focus\(\)/)
  assert.match(setup, /event\.key === 'Escape'/)
  assert.match(setup, /event\.key !== 'Tab'/)
  assert.match(setup, /previousFocus\?\.focus\(\)/)
})
