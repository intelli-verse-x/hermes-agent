import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { stringify } from 'yaml'

import { QUIZVERSE_CONTRACTS } from '../../../packages/quizverse-mcp/contracts.mjs'

const {
  inspectQuizverseProvision,
  QUIZVERSE_SKILL_IDS,
  validateQuizverseProbe
} = await import(new URL('./qv-mcp-readiness.ts', import.meta.url).href)

test('structurally verifies exact MCP config and all six skills', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qv-ready-'))
  const configPath = path.join(root, 'config.yaml')
  const relayPath = path.join(root, 'relay.mjs')
  const serverPath = path.join(root, 'server.mjs')
  const skillsRoot = path.join(root, 'skills')
  fs.writeFileSync(relayPath, '')
  fs.writeFileSync(serverPath, '')

  for (const skill of QUIZVERSE_SKILL_IDS) {
    fs.mkdirSync(path.join(skillsRoot, skill), { recursive: true })
    fs.writeFileSync(path.join(skillsRoot, skill, 'SKILL.md'), '# fixture')
  }

  const exact = {
    args: [relayPath],
    command: '/electron',
    enabled: true,
    env: {
      ELECTRON_RUN_AS_NODE: '1',
      QUIZVERSE_MCP_SERVER_SOCKET: '/server.sock'
    }
  }

  fs.writeFileSync(configPath, `# retained comment\n${stringify({ mcp_servers: { quizverse: exact }, unknown: true })}`)

  const input = {
    configPath,
    electronExecutable: '/electron',
    relayPath,
    serverPath,
    serverSocket: '/server.sock',
    skillsRoot
  }

  assert.equal(inspectQuizverseProvision(input).ready, true)
  fs.writeFileSync(configPath, '# args: relay.mjs\n# QUIZVERSE_MCP_SERVER_SOCKET: /server.sock\n')
  assert.match(inspectQuizverseProvision(input).reason, /stale|partial/)
  fs.writeFileSync(configPath, stringify({
    mcp_servers: { quizverse: { ...exact, args: ['/stale-relay.mjs'] } }
  }))
  assert.match(inspectQuizverseProvision(input).reason, /stale|partial/)
  fs.writeFileSync(configPath, stringify({ mcp_servers: { quizverse: exact } }))
  fs.rmSync(path.join(skillsRoot, QUIZVERSE_SKILL_IDS[0]), { recursive: true })
  assert.match(inspectQuizverseProvision(input).reason, /skills are incomplete/)
  fs.rmSync(root, { force: true, recursive: true })
})

test('requires the full tool identity set, capability, and safe read', () => {
  const toolIds = Object.keys(QUIZVERSE_CONTRACTS)
  const capability = { authKind: 'guest' as const, playerId: 'guest-1' }

  assert.equal(validateQuizverseProbe({ profileText: '{}', toolIds }, capability).ready, true)
  assert.equal(validateQuizverseProbe({ profileText: '{}', toolIds: toolIds.slice(1) }, capability).ready, false)
  assert.equal(validateQuizverseProbe({ profileText: 'bad', toolIds }, capability).ready, false)
  assert.equal(validateQuizverseProbe({ profileText: '{}', toolIds }, null).ready, false)
})
