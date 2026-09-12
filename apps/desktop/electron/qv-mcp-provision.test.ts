import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { parse } from 'yaml'

const { provisionQuizverseMcp } = await import(new URL('./qv-mcp-provision.ts', import.meta.url).href)

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qv-mcp-provision-'))
  const hermesHome = path.join(root, 'qv-home')
  const relayPath = path.join(root, 'relay.mjs')
  const serverPath = path.join(root, 'server.mjs')
  const skillsSource = path.join(root, 'skills')
  fs.writeFileSync(serverPath, '// fixture\n')
  fs.writeFileSync(relayPath, '// relay fixture\n')
  fs.mkdirSync(path.join(skillsSource, 'coach'), { recursive: true })
  fs.writeFileSync(path.join(skillsSource, 'coach', 'SKILL.md'), '# Coach\n')

  return { hermesHome, relayPath, root, serverPath, skillsSource }
}

test('provisions MCP paths and skills without credentials', () => {
  const input = fixture()

  const result = provisionQuizverseMcp({
    electronExecutable: '/Applications/QuizVerse',
    hermesHome: input.hermesHome,
    mcpRelayPath: input.relayPath,
    mcpServerPath: input.serverPath,
    skillsSource: input.skillsSource,
    socketPath: '/tmp/quizverse.sock'
  })

  const config = fs.readFileSync(path.join(input.hermesHome, 'config.yaml'), 'utf8')
  assert.equal(result.skillCount, 1)
  const parsed = parse(config)
  assert.equal(parsed.mcp_servers.quizverse.args[0], input.relayPath)
  assert.equal(parsed.mcp_servers.quizverse.env.QUIZVERSE_MCP_SERVER_SOCKET, '/tmp/quizverse.sock')
  assert.equal(parsed.mcp_servers.quizverse.env.QUIZVERSE_MCP_BROKER_SECRET, undefined)
  assert.doesNotMatch(config, /QUIZVERSE_MCP_BROKER_SECRET/)
  assert.doesNotMatch(config, /[A-Za-z0-9_-]{48,}/)
  assert.ok(fs.existsSync(path.join(input.hermesHome, 'skills', 'quizverse', 'coach', 'SKILL.md')))
})

test('preserves comments and unknown entries while reconciling stale paths', () => {
  const input = fixture()
  fs.mkdirSync(input.hermesHome, { recursive: true })
  fs.writeFileSync(
    path.join(input.hermesHome, 'config.yaml'),
    '# retain me\nunknown: true\nmcp_servers:\n  example:\n    url: "https://example.test"\n  quizverse:\n    command: "/stale"\n'
  )

  const options = {
    electronExecutable: '/QuizVerse',
    hermesHome: input.hermesHome,
    mcpRelayPath: input.relayPath,
    mcpServerPath: input.serverPath,
    skillsSource: input.skillsSource,
    socketPath: '/tmp/qv.sock'
  }

  provisionQuizverseMcp(options)
  const once = fs.readFileSync(path.join(input.hermesHome, 'config.yaml'), 'utf8')
  const second = provisionQuizverseMcp(options)
  const parsed = parse(once)
  assert.match(once, /# retain me/)
  assert.match(once, /example:/)
  assert.equal(parsed.unknown, true)
  assert.equal(parsed.mcp_servers.quizverse.command, '/QuizVerse')
  assert.equal(second.configChanged, false)
})

test('provisions only the supplied QuizVerse home', () => {
  const input = fixture()
  const ixHome = path.join(input.root, 'ix-home')
  fs.mkdirSync(ixHome, { recursive: true })
  fs.writeFileSync(path.join(ixHome, 'config.yaml'), 'model:\n  default: ix\n')
  provisionQuizverseMcp({
    electronExecutable: '/QuizVerse',
    hermesHome: input.hermesHome,
    mcpRelayPath: input.relayPath,
    mcpServerPath: input.serverPath,
    skillsSource: input.skillsSource,
    socketPath: '/tmp/qv.sock'
  })
  assert.doesNotMatch(fs.readFileSync(path.join(ixHome, 'config.yaml'), 'utf8'), /quizverse/i)
  assert.equal(fs.existsSync(path.join(ixHome, 'skills', 'quizverse')), false)
})

test('provisions a requested pooled profile independently of the active profile', () => {
  const input = fixture()
  const activeHome = path.join(input.hermesHome, 'profiles', 'active')
  const pooledHome = path.join(input.hermesHome, 'profiles', 'pooled')

  const base = {
    electronExecutable: '/QuizVerse',
    mcpRelayPath: input.relayPath,
    mcpServerPath: input.serverPath,
    skillsSource: input.skillsSource,
    socketPath: '/tmp/qv.sock'
  }

  provisionQuizverseMcp({ ...base, hermesHome: activeHome })
  provisionQuizverseMcp({ ...base, hermesHome: pooledHome })
  assert.match(fs.readFileSync(path.join(activeHome, 'config.yaml'), 'utf8'), /quizverse/)
  assert.match(fs.readFileSync(path.join(pooledHome, 'config.yaml'), 'utf8'), /quizverse/)
  assert.ok(fs.existsSync(path.join(pooledHome, 'skills', 'quizverse', 'coach', 'SKILL.md')))
})
