import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { test } from 'vitest'

import { provisionFoundrlySkills } from './foundrly-skills-provision'

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const skillsRoot = path.join(desktopRoot, 'brands', 'foundrly-skills')

const sectionOrder = [
  '## When to Use',
  '## Prerequisites',
  '## How to Run',
  '## Quick Reference',
  '## Procedure',
  '## Pitfalls',
  '## Verification'
]

test('every Foundrly skill satisfies authoring contracts (no invented MCP tools)', () => {
  const skillNames = fs
    .readdirSync(skillsRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)

  assert.ok(skillNames.length >= 3)

  for (const name of skillNames) {
    const text = fs.readFileSync(path.join(skillsRoot, name, 'SKILL.md'), 'utf8')
    const description = text.match(/^description: (.+)$/m)?.[1] || ''
    assert.ok(description.length > 0 && description.length <= 60, `${name} description length`)
    assert.match(description, /\.$/)
    assert.doesNotMatch(description, /\b(?:advanced|comprehensive|powerful|seamless)\b/i)
    assert.match(text, /^author: Intelliverse X/m)
    assert.match(text, /^platforms: \[macos, linux, windows\]$/m)

    let previous = -1

    for (const section of sectionOrder) {
      const index = text.indexOf(section)
      assert.ok(index > previous, `${name} section order: ${section}`)
      previous = index
    }

    // No speculative Foundrly MCP tool names — live portal tools stay on Admin copilot.
    assert.doesNotMatch(text, /\bfd_[a-z0-9_]+\b/)
    assert.doesNotMatch(text, /foundrly-mcp|FOUNDRLY_MCP/)
  }
})

test('provisionFoundrlySkills copies SKILL.md trees into HERMES_HOME/skills/foundrly', () => {
  const hermesHome = fs.mkdtempSync(path.join(os.tmpdir(), 'foundrly-skills-home-'))

  try {
    const result = provisionFoundrlySkills({ hermesHome, skillsSource: skillsRoot })

    assert.equal(result.destination, path.join(hermesHome, 'skills', 'foundrly'))
    assert.ok(result.skillCount >= 3)
    assert.ok(
      fs.existsSync(path.join(result.destination, 'foundrly-cofounder-coach', 'SKILL.md'))
    )
    assert.ok(
      fs.existsSync(path.join(result.destination, 'foundrly-product-surfaces', 'SKILL.md'))
    )
    assert.ok(
      fs.existsSync(path.join(result.destination, 'foundrly-overnight-visibility', 'SKILL.md'))
    )
  } finally {
    fs.rmSync(hermesHome, { force: true, recursive: true })
  }
})

test('IX and QuizVerse brand manifests do not reference foundrly-skills', () => {
  const ix = fs.readFileSync(path.join(desktopRoot, 'brands', 'ix-agency.json'), 'utf8')
  const qv = fs.readFileSync(path.join(desktopRoot, 'brands', 'quizverse.json'), 'utf8')

  assert.doesNotMatch(ix, /foundrly-skills/)
  assert.doesNotMatch(qv, /foundrly-skills/)
})

test('Foundrly brand ships foundrly-skills folder for installer extraResources', () => {
  assert.ok(fs.existsSync(path.join(skillsRoot, 'foundrly-cofounder-coach', 'SKILL.md')))
  assert.ok(fs.existsSync(path.join(skillsRoot, 'foundrly-product-surfaces', 'SKILL.md')))
  assert.ok(fs.existsSync(path.join(skillsRoot, 'foundrly-overnight-visibility', 'SKILL.md')))

  // Packaging already maps brands/foundrly-skills → foundrly-skills (apply-brand.mjs).
  // Assert the source tree exists; do not invent a foundrly-mcp package.
  assert.equal(fs.existsSync(path.join(desktopRoot, 'packages', 'foundrly-mcp')), false)
  assert.equal(fs.existsSync(path.join(desktopRoot, '..', '..', 'packages', 'foundrly-mcp')), false)
})
