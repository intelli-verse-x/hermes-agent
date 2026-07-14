import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const skillsRoot = path.join(desktopRoot, 'brands', 'quizverse-skills')

const sectionOrder = [
  '## When to Use',
  '## Prerequisites',
  '## How to Run',
  '## Quick Reference',
  '## Procedure',
  '## Pitfalls',
  '## Verification'
]

test('every QuizVerse skill satisfies authoring and tool contracts', async () => {
  const skillNames = fs
    .readdirSync(skillsRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)

  const { TOOLS } = await import(
    new URL('../../../packages/quizverse-mcp/server.mjs', import.meta.url).href
  )

  const toolNames = new Set(TOOLS.map((tool: { name: string }) => tool.name))
  assert.ok(skillNames.length >= 6)

  for (const name of skillNames) {
    const text = fs.readFileSync(path.join(skillsRoot, name, 'SKILL.md'), 'utf8')
    const description = text.match(/^description: (.+)$/m)?.[1] || ''
    assert.ok(description.length > 0 && description.length <= 60, `${name} description length`)
    assert.match(description, /\.$/)
    assert.doesNotMatch(description, /\b(?:advanced|comprehensive|powerful|seamless)\b/i)
    assert.match(text, /^author: Devashish Badlani/m)
    assert.match(text, /^platforms: \[macos, linux, windows\]$/m)

    let previous = -1

    for (const section of sectionOrder) {
      const index = text.indexOf(section)
      assert.ok(index > previous, `${name} section order: ${section}`)
      previous = index
    }

    for (const tool of text.match(/\bqv_[a-z0-9_]+\b/g) ?? []) {
      assert.ok(toolNames.has(tool), `${name} references unavailable tool ${tool}`)
    }

    assert.doesNotMatch(text, /ADMIN_MCP_TOKEN|refresh_token|safeStorage|nakama-mcp/)
  }
})

test('IX brand manifest does not reference QuizVerse skills or MCP', () => {
  const ixManifest = fs.readFileSync(path.join(desktopRoot, 'brands', 'ix-agency.json'), 'utf8')

  assert.doesNotMatch(ixManifest, /quizverse-skills|quizverse-mcp/)
})

test('social guidance exposes only implemented party operations', () => {
  const social = fs.readFileSync(
    path.join(skillsRoot, 'quizverse-social-party', 'SKILL.md'),
    'utf8'
  )

  assert.match(social, /qv_party_create/)
  assert.match(social, /qv_party_join/)
  assert.match(social, /qv_party_status/)
})
