import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const skillPath = path.join(repoRoot, 'skills', 'local-first-inference', 'SKILL.md')
const text = fs.readFileSync(skillPath, 'utf8')
const voiceSkillPath = path.join(repoRoot, 'skills', 'desktop-voice-actions', 'SKILL.md')
const voiceText = fs.readFileSync(voiceSkillPath, 'utf8')
const frontmatter = text.match(/^---\n([\s\S]*?)\n---\n/)

test('local-first inference skill is concise and auto-discoverable', () => {
  assert.ok(frontmatter, 'valid YAML frontmatter is required')
  assert.match(frontmatter[1], /^name: local-first-inference$/m)

  const description = frontmatter[1].match(/^description: (.+)$/m)?.[1] ?? ''
  assert.ok(description.length > 0 && description.length <= 220, 'description must be concise')
  assert.match(description, /\b(?:local|inference|routing)\b/i)
  assert.match(description, /\bUse (?:for|when)\b/)
  assert.doesNotMatch(frontmatter[1], /^disable-model-invocation:\s*true$/m)

  const tokenLikeCount = text.match(/[A-Za-z0-9_`.-]+|[^\sA-Za-z0-9_`.-]/g)?.length ?? 0
  assert.ok(text.length <= 3_000, `skill exceeds character budget: ${text.length}`)
  assert.ok(tokenLikeCount <= 600, `skill exceeds token-like budget: ${tokenLikeCount}`)
})

test('local-first inference skill preserves privacy and governed escalation', () => {
  assert.match(text, /Runtime code and live status are authoritative/i)
  assert.match(text, /Inspect the current policy, local runtime status, model capabilities/i)
  assert.match(text, /Use local inference when policy permits/i)
  assert.match(text, /local-only.+hard boundaries/is)
  assert.match(text, /never send prompts, responses, tool arguments, or sensitive context to cloud/i)
  assert.match(text, /Do not use a cloud model as a judge/i)
  assert.match(text, /smallest sufficient recent context/i)
  assert.match(text, /Never silently retry in cloud/i)
})

test('local-first inference skill reports only measured savings', () => {
  assert.match(text, /authoritative measured counters or billing data/i)
  assert.match(text, /baseline, units, and period/i)
  assert.match(text, /If measurements are unavailable, say savings are unknown/i)
  assert.doesNotMatch(text, /\b(?:guaranteed|estimated) savings\b/i)
})

test('local-first inference skill contains no secrets or brand leakage', () => {
  assert.doesNotMatch(
    text,
    /(?:API[_ -]?KEY|ACCESS[_ -]?TOKEN|CLIENT[_ -]?SECRET|BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY|Bearer\s+[A-Za-z0-9._~-]+)/i
  )
  assert.doesNotMatch(text, /\b(?:QuizVerse|TutorX|Intelli[- ]?Verse|IX Agency|Hermes Agent)\b/i)
})

test('both desktop brands package the shared skill and verified catalogs', () => {
  const desktopPackage = JSON.parse(fs.readFileSync(path.join(repoRoot, 'apps', 'desktop', 'package.json'), 'utf8'))
  const resources = desktopPackage.build?.extraResources ?? []
  const resourceTargets = resources.map((entry: { to?: string }) => entry.to)

  assert.ok(resourceTargets.includes('hermes-skills/local-first-inference'))
  assert.ok(resourceTargets.includes('hermes-skills/desktop-voice-actions'))
  assert.ok(resourceTargets.includes('local-ai/local-ai-model-catalog.v1.json'))
  assert.ok(resourceTargets.includes('local-ai/local-ai-runtime-catalog.v1.json'))
})

test('release verification inspects branded DMG, ZIP, and unpacked resources', () => {
  const desktopScript = fs.readFileSync(path.join(repoRoot, 'apps', 'desktop', 'scripts', 'test-desktop.mjs'), 'utf8')
  const artifactScript = fs.readFileSync(
    path.join(repoRoot, 'apps', 'desktop', 'scripts', 'verify-platform-artifacts.mjs'),
    'utf8'
  )

  assert.match(desktopScript, /BRAND\.artifactPrefix/)
  assert.match(artifactScript, /Expected a macOS DMG artifact/)
  assert.match(artifactScript, /hdiutil/)
  assert.match(artifactScript, /Expected a macOS ZIP artifact/)
})

test('desktop voice skill is auto-discoverable, brand-neutral, and governed', () => {
  assert.match(voiceText, /^name: desktop-voice-actions$/m)
  assert.doesNotMatch(voiceText, /^disable-model-invocation:\s*true$/m)
  assert.match(voiceText, /Runtime policy.+authoritative/i)
  assert.match(voiceText, /Spoken words.+never approve/is)
  assert.match(voiceText, /computer-use and local-first-inference skills/i)
  assert.match(voiceText, /input_modality=voice/)
  assert.match(voiceText, /fail closed/i)
  assert.doesNotMatch(voiceText, /\b(?:QuizVerse|TutorX|Intelli[- ]?Verse|IX Agency|Hermes Agent)\b/i)
  assert.ok(voiceText.length <= 3_500)
})
