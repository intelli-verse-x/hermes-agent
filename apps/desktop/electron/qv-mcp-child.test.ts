import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { RESPONSE_FIXTURES } from '../../../packages/quizverse-mcp/test/response-fixtures.mjs'

const { startQuizverseMcpBroker, stopQuizverseMcpBroker } = await import(
  new URL('./qv-mcp-broker.ts', import.meta.url).href
)

const {
  buildQuizverseMcpChildEnv,
  probeQuizverseMcp,
  quizverseMcpKillFallback,
  scrubQuizverseMcpSecret,
  startQuizverseMcpChild,
  stopQuizverseMcpChild
} = await import(
  new URL('./qv-mcp-child.ts', import.meta.url).href
)

test('scopes the broker secret to the directly managed MCP child', () => {
  const secret = 'x'.repeat(64)
  const parentBefore = process.env.QUIZVERSE_MCP_BROKER_SECRET

  const env = buildQuizverseMcpChildEnv({
    brokerSecret: secret,
    brokerSocket: '/broker',
    executable: '/electron',
    serverPath: '/server.mjs',
    serverSocket: '/server'
  })

  assert.equal(env.QUIZVERSE_MCP_BROKER_SECRET, secret)
  assert.equal(process.env.QUIZVERSE_MCP_BROKER_SECRET, parentBefore)
  assert.deepEqual(Object.keys(env).sort(), [
    'ELECTRON_RUN_AS_NODE',
    'QUIZVERSE_MCP_BROKER_SECRET',
    'QUIZVERSE_MCP_BROKER_SOCKET',
    'QUIZVERSE_MCP_LISTEN_SOCKET'
  ])
  assert.equal(env.HERMES_HOME, undefined)
  assert.equal(env.PATH, undefined)
  assert.deepEqual(
    scrubQuizverseMcpSecret({ KEEP_ME: 'yes', QUIZVERSE_MCP_BROKER_SECRET: secret }),
    { KEEP_ME: 'yes' }
  )
})

test('starts, probes, and reaps the directly managed MCP child', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qv-mcp-child-'))

  const serverSocket = process.platform === 'win32'
    ? `\\\\.\\pipe\\qv-mcp-child-${crypto.randomUUID()}`
    : path.join(root, 'server.sock')

  const brokerSocket = process.platform === 'win32'
    ? `\\\\.\\pipe\\qv-mcp-broker-${crypto.randomUUID()}`
    : path.join(root, 'broker.sock')

  const secret = crypto.randomBytes(48).toString('base64url')

  const broker = await startQuizverseMcpBroker({
    auditPath: path.join(root, 'audit.jsonl'),
    handlers: {
      approve: async () => false,
      capability: async () => ({ authKind: 'guest', playerId: 'fixture-guest' }),
      rpc: async () => RESPONSE_FIXTURES.qv_profile_get,
      tutor: async () => RESPONSE_FIXTURES.qv_tutorx_sessions
    },
    idempotencyPath: path.join(root, 'idempotency.json'),
    secret,
    socketPath: brokerSocket
  })

  const child = await startQuizverseMcpChild({
    brokerSecret: secret,
    brokerSocket,
    executable: process.execPath,
    serverPath: path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../../packages/quizverse-mcp/server.mjs'),
    serverSocket
  })

  const probe = await probeQuizverseMcp(serverSocket)
  assert.equal(probe.toolIds.length, 27)
  assert.match(probe.profileText, /fixture-guest/)
  const exited = new Promise(resolve => child.once('exit', resolve))

  await stopQuizverseMcpChild(child, serverSocket)
  await Promise.race([
    exited,
    new Promise((_, reject) => setTimeout(() => reject(new Error('managed MCP child did not exit')), 1_000))
  ])
  assert.equal(child.exitCode === null, false)

  if (process.platform !== 'win32') {assert.equal(fs.existsSync(serverSocket), false)}
  stopQuizverseMcpBroker(broker, brokerSocket)
  fs.rmSync(root, { force: true, recursive: true })
})

test('escalates a hung child and defines both platform fallbacks', async () => {
  assert.equal(quizverseMcpKillFallback('win32'), 'taskkill')
  assert.equal(quizverseMcpKillFallback('darwin'), 'SIGKILL')

  if (process.platform === 'win32') {return}

  const child = spawn(process.execPath, [
    '-e',
    "process.on('SIGTERM',()=>{}); console.log('ready'); setInterval(()=>{},1000)"
  ], { stdio: ['ignore', 'pipe', 'ignore'] })

  await new Promise(resolve => child.stdout?.once('data', resolve))
  await stopQuizverseMcpChild(child, '/tmp/qv-hung-child-test.sock', { graceMs: 25 })
  assert.equal(child.signalCode, 'SIGKILL')
})
