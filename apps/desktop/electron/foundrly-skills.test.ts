import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { test } from 'vitest'

import { foundrlyMcpEntry, provisionFoundrlyMcp } from './foundrly-mcp-provision'
import { provisionFoundrlySkills } from './foundrly-skills-provision'

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const repoRoot = path.resolve(desktopRoot, '..', '..')
const skillsRoot = path.join(desktopRoot, 'brands', 'foundrly-skills')
const mcpRoot = path.join(repoRoot, 'packages', 'foundrly-mcp')

const sectionOrder = [
  '## When to Use',
  '## Prerequisites',
  '## How to Run',
  '## Quick Reference',
  '## Procedure',
  '## Pitfalls',
  '## Verification'
]

test('every Foundrly skill documents fd_product_knowledge and not portal admin MCP', () => {
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
    assert.match(text, /^author: Intelliverse X/m)
    assert.match(text, /fd_product_knowledge/)

    let previous = -1

    for (const section of sectionOrder) {
      const index = text.indexOf(section)
      assert.ok(index > previous, `${name} section order: ${section}`)
      previous = index
    }

    assert.doesNotMatch(text, /Mail Studio.*fd_|fd_.*Mail Studio/i)
    assert.doesNotMatch(text, /\bfd_crm\b|\bfd_mail\b/i)
  }
})

test('provisionFoundrlySkills copies SKILL.md trees into HERMES_HOME/skills/foundrly', () => {
  const hermesHome = fs.mkdtempSync(path.join(os.tmpdir(), 'foundrly-skills-home-'))

  try {
    const result = provisionFoundrlySkills({ hermesHome, skillsSource: skillsRoot })
    assert.equal(result.destination, path.join(hermesHome, 'skills', 'foundrly'))
    assert.ok(result.skillCount >= 3)
  } finally {
    fs.rmSync(hermesHome, { force: true, recursive: true })
  }
})

test('provisionFoundrlyMcp writes mcp_servers.foundrly stdio entry and copies skills', () => {
  const hermesHome = fs.mkdtempSync(path.join(os.tmpdir(), 'foundrly-mcp-home-'))
  const serverPath = path.join(mcpRoot, 'server.mjs')

  try {
    const result = provisionFoundrlyMcp({
      electronExecutable: '/fake/electron',
      hermesHome,
      mcpServerPath: serverPath,
      skillsSource: skillsRoot
    })

    assert.equal(result.serverPath, serverPath)
    assert.ok(result.skillCount >= 3)
    assert.equal(result.configChanged, true)

    const config = fs.readFileSync(path.join(hermesHome, 'config.yaml'), 'utf8')
    assert.match(config, /mcp_servers:/)
    assert.match(config, /foundrly:/)
    assert.match(config, /ELECTRON_RUN_AS_NODE/)
    assert.match(config, /server\.mjs/)
    assert.doesNotMatch(config, /BROKER_SECRET|mail.?studio|crm/i)

    const entry = foundrlyMcpEntry({
      electronExecutable: '/fake/electron',
      mcpServerPath: serverPath
    })
    assert.deepEqual(entry.env, { ELECTRON_RUN_AS_NODE: '1' })
    assert.deepEqual(entry.args, [serverPath])
  } finally {
    fs.rmSync(hermesHome, { force: true, recursive: true })
  }
})

test('foundrly-mcp package ships knowledge.md and single-tool server source', () => {
  const serverSource = fs.readFileSync(path.join(mcpRoot, 'server.mjs'), 'utf8')
  const knowledge = fs.readFileSync(path.join(mcpRoot, 'knowledge.md'), 'utf8')

  assert.match(serverSource, /name: 'fd_product_knowledge'/)
  assert.doesNotMatch(serverSource, /fd_crm|fd_mail|mail_studio/i)
  assert.match(knowledge, /AI co-founder/)
  assert.match(knowledge, /Mail Studio/)
  assert.match(knowledge, /Admin copilot/)
})

test('IX and QuizVerse brand manifests do not reference foundrly-mcp', () => {
  const ix = fs.readFileSync(path.join(desktopRoot, 'brands', 'ix-agency.json'), 'utf8')
  const qv = fs.readFileSync(path.join(desktopRoot, 'brands', 'quizverse.json'), 'utf8')

  assert.doesNotMatch(ix, /foundrly-mcp|foundrly-skills/)
  assert.doesNotMatch(qv, /foundrly-mcp|foundrly-skills/)
})
