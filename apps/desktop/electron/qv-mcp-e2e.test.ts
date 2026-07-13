import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { RESPONSE_FIXTURES } from '../../../packages/quizverse-mcp/test/response-fixtures.mjs'

const {
  startQuizverseMcpBroker,
  stopQuizverseMcpBroker
} = await import(new URL('./qv-mcp-broker.ts', import.meta.url).href)

const {
  startQuizverseMcpChild,
  stopQuizverseMcpChild
} = await import(new URL('./qv-mcp-child.ts', import.meta.url).href)

test('guest broker through secretless relay reads a normalized profile', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qv-mcp-e2e-'))
  const brokerSocket = localSocket(root, 'broker')
  const serverSocket = localSocket(root, 'server')
  const profileHome = path.join(root, 'profiles', 'learner')
  const secret = crypto.randomBytes(48).toString('base64url')
  const writes: unknown[] = []

  const broker = await startQuizverseMcpBroker({
    auditPath: path.join(profileHome, 'logs', 'quizverse-mcp-audit.jsonl'),
    handlers: {
      approve: async () => true,
      capability: async () => ({ authKind: 'guest', playerId: 'fixture-guest' }),
      rpc: async (name, payload) => {
        if (name === 'quiz_submit_result_v2') {
          writes.push(payload)

          return RESPONSE_FIXTURES.qv_quiz_submit
        }

        if (name === 'player_get_full_profile') {return RESPONSE_FIXTURES.qv_profile_get}
        throw new Error(`Unexpected E2E RPC: ${name}`)
      },
      tutor: async () => RESPONSE_FIXTURES.qv_tutorx_sessions
    },
    idempotencyPath: path.join(profileHome, 'quizverse-mcp-idempotency.json'),
    secret,
    socketPath: brokerSocket
  })

  assert.equal((await brokerRequest(brokerSocket, { id: 'missing', operation: 'capability' })).ok, false)
  assert.equal((await brokerRequest(brokerSocket, {
    auth: 'wrong-secret',
    id: 'wrong',
    operation: 'capability'
  })).ok, false)

  const packageRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../../packages/quizverse-mcp')

  const child = await startQuizverseMcpChild({
    brokerSecret: secret,
    brokerSocket,
    executable: process.execPath,
    serverPath: path.join(packageRoot, 'server.mjs'),
    serverSocket
  })

  const relay = spawn(process.execPath, [path.join(packageRoot, 'relay.mjs')], {
    env: { QUIZVERSE_MCP_SERVER_SOCKET: serverSocket },
    stdio: ['pipe', 'pipe', 'pipe']
  })

  assert.equal(relay.spawnargs.some(argument => argument.includes(secret)), false)
  assert.equal(relay.spawnargs.some(argument => argument.includes('BROKER_SECRET')), false)

  t.after(async () => {
    relay.kill('SIGTERM')
    await stopQuizverseMcpChild(child, serverSocket)
    stopQuizverseMcpBroker(broker, brokerSocket)
    fs.rmSync(root, { force: true, recursive: true })
  })

  const request = relayRequester(relay)
  const uninitialized = await request({ id: 1, jsonrpc: '2.0', method: 'tools/list' })
  assert.equal(uninitialized.error.code, -32002)

  const initialized = await request({
    id: 2,
    jsonrpc: '2.0',
    method: 'initialize',
    params: {
      capabilities: {},
      clientInfo: { name: 'desktop-relay-e2e', version: '1.0.0' },
      protocolVersion: '2025-03-26'
    }
  })

  assert.equal(initialized.result.protocolVersion, '2025-03-26')
  const tools = await request({ id: 3, jsonrpc: '2.0', method: 'tools/list' })
  assert.equal(tools.result.tools.length, 27)

  const profile = await request({
    id: 4,
    jsonrpc: '2.0',
    method: 'resources/read',
    params: { uri: 'qv://player/profile' }
  })

  const normalizedProfile = JSON.parse(profile.result.contents[0].text)
  assert.equal(normalizedProfile.contractVersion, 'full-profile-v1')
  assert.equal(normalizedProfile.data.userId, 'fixture-guest')

  const idempotencyKey = crypto.randomUUID()

  const args = {
    answers: [{ latency_ms: 20, question_id: 'q1', selected_index: 0 }],
    duration_ms: 20,
    idempotency_key: idempotencyKey,
    mode: 'DailyQuiz',
    question_pack_id: 'pack-fixture'
  }

  const first = await request({
    id: 5,
    jsonrpc: '2.0',
    method: 'tools/call',
    params: { arguments: args, name: 'qv_quiz_submit' }
  })

  assert.equal(writes.length, 0)
  const challenge = first.result.structuredContent.data.approval_challenge
  await request({
    id: 6,
    jsonrpc: '2.0',
    method: 'tools/call',
    params: { arguments: { ...args, approval_challenge: challenge }, name: 'qv_quiz_submit' }
  })
  assert.equal(writes.length, 1)

  const audit = fs.readFileSync(path.join(profileHome, 'logs', 'quizverse-mcp-audit.jsonl'), 'utf8')
  assert.doesNotMatch(audit, new RegExp(secret))
  assert.match(audit, /fixture-guest/)
  assert.notEqual(process.env.QUIZVERSE_MCP_BROKER_SECRET, secret)
})

function localSocket(root: string, name: string): string {
  return process.platform === 'win32'
    ? `\\\\.\\pipe\\qv-mcp-${name}-${crypto.randomUUID()}`
    : path.join(root, `${name}.sock`)
}

function brokerRequest(socketPath: string, request: Record<string, unknown>): Promise<Record<string, any>> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath)
    let text = ''
    socket.setEncoding('utf8')
    socket.once('connect', () => socket.write(`${JSON.stringify(request)}\n`))
    socket.on('data', chunk => {
      text += chunk
      const newline = text.indexOf('\n')

      if (newline >= 0) {
        socket.destroy()
        resolve(JSON.parse(text.slice(0, newline)))
      }
    })
    socket.once('error', reject)
  })
}

function relayRequester(child: ReturnType<typeof spawn>) {
  let output = ''
  const waiters = new Map<number, (value: Record<string, any>) => void>()
  child.stdout?.setEncoding('utf8')
  child.stdout?.on('data', chunk => {
    output += chunk
    let newline

    while ((newline = output.indexOf('\n')) >= 0) {
      const message = JSON.parse(output.slice(0, newline))
      output = output.slice(newline + 1)
      waiters.get(message.id)?.(message)
      waiters.delete(message.id)
    }
  })

  return (message: Record<string, any>) => new Promise<Record<string, any>>(resolve => {
    waiters.set(message.id, resolve)
    child.stdin?.write(`${JSON.stringify(message)}\n`)
  })
}
