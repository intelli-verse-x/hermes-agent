import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import test from 'node:test'

import { QUIZVERSE_CONTRACTS } from '../contracts.mjs'
import {
  QUIZ_FETCH_ROUTES,
  validateAndNormalizeQuizFetchResponse,
  validateQuizFetchRequest
} from '../quiz-fetch-contracts.mjs'
import { validateAndNormalizeQuizverseResponse } from '../response-contracts.mjs'
import { TOOLS } from '../server.mjs'
import {
  EXTERNAL_PROVIDER_FIXTURES,
  QUIZ_FETCH_ROUTE_FIXTURES,
  RESPONSE_FIXTURES,
  WEEKLY_RAW_JSON_FIXTURES,
  WEEKLY_RAW_JSON_NEGATIVE_FIXTURES
} from './response-fixtures.mjs'

const SERVER = new URL('../server.mjs', import.meta.url)
const RELAY = new URL('../relay.mjs', import.meta.url)
const withoutSource = args => Object.fromEntries(
  Object.entries(args).filter(([key]) => key !== 'source')
)
const titleCase = value => value.replace(/(^|[\s-])([a-z])/g, (_match, prefix, character) =>
  `${prefix}${character.toUpperCase()}`)

test('every exposed tool has one shared broker contract', () => {
  assert.deepEqual(
    TOOLS.map(tool => tool.name).sort(),
    Object.keys(QUIZVERSE_CONTRACTS).sort()
  )
})

test('all source-derived responses validate and normalize per tool', () => {
  assert.deepEqual(Object.keys(RESPONSE_FIXTURES).sort(), Object.keys(QUIZVERSE_CONTRACTS).sort())
  for (const [tool, response] of Object.entries(RESPONSE_FIXTURES)) {
    const normalized = tool === 'qv_quiz_fetch'
      ? validateAndNormalizeQuizFetchResponse(
        QUIZ_FETCH_ROUTE_FIXTURES.request.rpc,
        withoutSource(QUIZ_FETCH_ROUTE_FIXTURES.request.args),
        response
      )
      : validateAndNormalizeQuizverseResponse(tool, response)
    assert.equal(normalized.contractVersion, QUIZVERSE_CONTRACTS[tool].response.version)
    assert.equal(typeof normalized.success, 'boolean')
    assert.ok(normalized.data && typeof normalized.data === 'object')
  }
  assert.throws(
    () => validateAndNormalizeQuizverseResponse('qv_reward_claim', {
      data: { nextReward: 110, rewardAmount: -1, streak: 'one' },
      success: true
    }),
    /violates/
  )
  assert.throws(
    () => validateAndNormalizeQuizverseResponse('qv_party_status', {
      players: [],
      status: 'invented',
      success: true,
      ticketId: 'ticket'
    }),
    /violates/
  )
})

test('quiz fetch contracts bind each source to its RPC and adapter', () => {
  assert.deepEqual(Object.keys(QUIZ_FETCH_ROUTE_FIXTURES).sort(), Object.keys(QUIZ_FETCH_ROUTES).sort())
  for (const [source, fixture] of Object.entries(QUIZ_FETCH_ROUTE_FIXTURES)) {
    const route = validateQuizFetchRequest(fixture.args)
    assert.equal(route, QUIZ_FETCH_ROUTES[source])
    assert.equal(fixture.rpc, route.rpc)
    const normalized = validateAndNormalizeQuizFetchResponse(
      fixture.rpc,
      withoutSource(fixture.args),
      fixture.response
    )
    assert.equal(normalized.data.route, source)
    assert.equal(normalized.data.provenance.rpc, fixture.rpc)
    assert.equal(normalized.data.provenance.adapter, route.responseAdapter)
  }
})

test('quiz fetch validator rejects malformed, unknown, and ranged data', () => {
  assert.throws(
    () => validateQuizFetchRequest({ ...QUIZ_FETCH_ROUTE_FIXTURES.weekly.args, iso_day: 8 }),
    /maximum/
  )
  assert.throws(
    () => validateQuizFetchRequest({ ...QUIZ_FETCH_ROUTE_FIXTURES.news.args, invented: true }),
    /unknown/
  )
  assert.throws(
    () => validateQuizFetchRequest({ ...QUIZ_FETCH_ROUTE_FIXTURES.external.args, provider: 'unknown' }),
    /unsupported/
  )
  assert.throws(
    () => validateAndNormalizeQuizFetchResponse(
      QUIZ_FETCH_ROUTE_FIXTURES.weekly.rpc,
      withoutSource(QUIZ_FETCH_ROUTE_FIXTURES.weekly.args),
      { raw_json: '{not-json}' }
    ),
    /not valid JSON/
  )
})

test('every declared external provider has a source-shaped response adapter', () => {
  for (const [provider, response] of Object.entries(EXTERNAL_PROVIDER_FIXTURES)) {
    const normalized = validateAndNormalizeQuizFetchResponse(
      QUIZ_FETCH_ROUTES.external.rpc,
      { provider },
      response
    )
    assert.equal(normalized.data.provenance.provider, provider)
    assert.equal(normalized.data.rawMetadata.upstreamContract, `${provider}-raw-v1`)
    assert.ok(normalized.data.questions.length > 0)
  }
})

test('weekly raw JSON ports every source wrapper and question alias', () => {
  const weekly = QUIZ_FETCH_ROUTE_FIXTURES.weekly
  for (const [fixtureName, raw] of Object.entries(WEEKLY_RAW_JSON_FIXTURES)) {
    const normalized = validateAndNormalizeQuizFetchResponse(
      weekly.rpc,
      withoutSource(weekly.args),
      { raw_json: JSON.stringify(raw) }
    )
    assert.equal(normalized.success, true)
    assert.ok(normalized.data.questions.length > 0, fixtureName)
    assert.equal(
      normalized.data.rawMetadata.inputCount,
      normalized.data.rawMetadata.acceptedCount
    )
    for (const question of normalized.data.questions) {
      assert.ok(question.prompt)
      if (question.type !== 'subjective') {
        assert.ok(question.options.length >= 2)
        assert.ok(question.correctIndex >= 0 && question.correctIndex < question.options.length)
      }
    }
  }
  const root = validateAndNormalizeQuizFetchResponse(
    weekly.rpc,
    withoutSource(weekly.args),
    { raw_json: JSON.stringify(WEEKLY_RAW_JSON_FIXTURES.rootArray) }
  ).data.questions[0]
  assert.equal(root.category, 'Geography')
  assert.equal(root.difficulty, 'easy')
  assert.equal(root.mediaUrl, 'https://cdn.example/flag.png')
  assert.deepEqual(root.options, ['India', 'Japan', 'Brazil', 'Kenya', 'Canada'])

  const mixed = validateAndNormalizeQuizFetchResponse(
    weekly.rpc,
    withoutSource(weekly.args),
    {
      raw_json: JSON.stringify({
        items: [
          ...WEEKLY_RAW_JSON_FIXTURES.items.items,
          { prompt: '', options: ['A'], correct_answer: 2 }
        ]
      })
    }
  )
  assert.equal(mixed.data.questions.length, 1)
  assert.equal(mixed.data.rawMetadata.inputCount, 2)
  assert.equal(mixed.data.rawMetadata.rejectedCount, 1)
})

test('weekly raw JSON rejects payloads with no answerable source entries', () => {
  const weekly = QUIZ_FETCH_ROUTE_FIXTURES.weekly
  for (const [fixtureName, raw] of Object.entries(WEEKLY_RAW_JSON_NEGATIVE_FIXTURES)) {
    assert.throws(
      () => validateAndNormalizeQuizFetchResponse(
        weekly.rpc,
        withoutSource(weekly.args),
        { raw_json: JSON.stringify(raw) }
      ),
      /no supported question wrapper|no answerable questions/,
      fixtureName
    )
  }
})

test('Star Wars adapter creates character-specific answerable eye-colour questions', () => {
  const normalized = validateAndNormalizeQuizFetchResponse(
    QUIZ_FETCH_ROUTES.external.rpc,
    { provider: 'starwars' },
    EXTERNAL_PROVIDER_FIXTURES.starwars
  )
  assert.equal(normalized.success, true)
  assert.ok(normalized.data.questions.length >= 4)
  for (const [index, question] of normalized.data.questions.entries()) {
    const character = EXTERNAL_PROVIDER_FIXTURES.starwars[index]
    const answer = titleCase(character.eye_color)
    assert.match(question.prompt, new RegExp(character.name))
    assert.match(question.prompt, /eyes.*Star Wars/i)
    assert.equal(question.options.filter(option => option === answer).length, 1)
    assert.equal(question.options[question.correctIndex], answer)
    assert.equal(new Set(question.options).size, 4)
    assert.ok(question.options.every(option => typeof option === 'string' && option.length > 0))
  }
})

function socketPath(root) {
  return process.platform === 'win32'
    ? `\\\\.\\pipe\\qv-mcp-test-${crypto.randomUUID()}`
    : path.join(root, 'broker.sock')
}

function normalizedFixture(request) {
  if (request.tool === 'qv_quiz_fetch') {
    const fixture = Object.values(QUIZ_FETCH_ROUTE_FIXTURES).find(item => item.rpc === request.rpc)
    assert.ok(fixture, `missing routed fixture for ${request.rpc}`)
    return validateAndNormalizeQuizFetchResponse(request.rpc, request.payload, fixture.response)
  }
  return validateAndNormalizeQuizverseResponse(request.tool, RESPONSE_FIXTURES[request.tool])
}

async function fixture({ delayReads = false, timeoutMs } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qv-mcp-'))
  const socket = socketPath(root)
  const secret = crypto.randomBytes(48).toString('base64url')
  const calls = []
  const challenges = new Map()
  const broker = net.createServer(connection => {
    let text = ''
    connection.setEncoding('utf8')
    connection.on('data', chunk => {
      text += chunk
      const newline = text.indexOf('\n')
      if (newline < 0) return
      const request = JSON.parse(text.slice(0, newline))
      if (request.auth !== secret) {
        connection.end(`${JSON.stringify({ id: request.id, ok: false, error: 'unauthorized' })}\n`)
        return
      }
      calls.push(request)
      let result
      if (request.operation === 'capability') result = { authKind: 'authenticated', playerId: 'player-fixture' }
      else if (request.operation === 'prepare') {
        const challenge = crypto.randomBytes(24).toString('base64url')
        challenges.set(challenge, request)
        result = { approval_challenge: challenge, approved: true, confirmation_required: true }
      } else if (request.operation === 'execute') {
        assert.ok(challenges.has(request.challenge))
        result = normalizedFixture(request)
      } else {
        result = normalizedFixture(request)
      }
      const respond = () => connection.end(`${JSON.stringify({ id: request.id, ok: true, result })}\n`)
      if (delayReads && request.operation === 'read') setTimeout(respond, 500)
      else respond()
    })
  })
  await new Promise((resolve, reject) => {
    broker.once('error', reject)
    broker.listen(socket, resolve)
  })
  const child = spawn(process.execPath, [SERVER.pathname], {
    env: {
      ...process.env,
      QUIZVERSE_MCP_BROKER_SECRET: secret,
      QUIZVERSE_MCP_BROKER_SOCKET: socket,
      ...(timeoutMs ? { QUIZVERSE_MCP_TIMEOUT_MS: String(timeoutMs) } : {})
    },
    stdio: ['pipe', 'pipe', 'pipe']
  })
  let output = ''
  const waiters = []
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', chunk => {
    output += chunk
    let newline
    while ((newline = output.indexOf('\n')) >= 0) {
      const line = output.slice(0, newline)
      output = output.slice(newline + 1)
      waiters.shift()?.(JSON.parse(line))
    }
  })
  const request = message => new Promise(resolve => {
    waiters.push(resolve)
    child.stdin.write(`${typeof message === 'string' ? message : JSON.stringify(message)}\n`)
  })
  const close = async () => {
    child.kill()
    broker.close()
    if (process.platform !== 'win32') {
      try { fs.unlinkSync(socket) } catch { /* already closed */ }
    }
    fs.rmSync(root, { recursive: true, force: true })
  }

  return { calls, child, close, request }
}

const init = {
  id: 1,
  jsonrpc: '2.0',
  method: 'initialize',
  params: {
    capabilities: {},
    clientInfo: { name: 'quizverse-test', version: '1.0.0' },
    protocolVersion: '2025-03-26'
  }
}

test('stdio protocol negotiates, validates, and shuts down', async () => {
  const fx = await fixture()
  try {
    const malformed = await fx.request('{')
    assert.deepEqual({ code: malformed.error.code, id: malformed.id }, { code: -32700, id: null })
    const invalid = await fx.request({ id: 2, jsonrpc: '1.0', method: 'ping' })
    assert.equal(invalid.error.code, -32600)
    const missingMetadata = await fx.request({ ...init, id: 3, params: { protocolVersion: '2025-03-26' } })
    assert.equal(missingMetadata.error.code, -32602)
    const unsupported = await fx.request({
      ...init,
      id: 31,
      params: { ...init.params, protocolVersion: '1900-01-01' }
    })
    assert.equal(unsupported.error.code, -32602)
    assert.equal((await fx.request(init)).result.protocolVersion, '2025-03-26')
    const listed = await fx.request({ id: 4, jsonrpc: '2.0', method: 'tools/list' })
    assert.equal(listed.result.tools.length, 27)
    assert.ok(listed.result.tools.some(tool => tool.name === 'qv_party_create'))
    const prompt = await fx.request({ id: 5, jsonrpc: '2.0', method: 'prompts/get', params: { name: 'quiz-coach', arguments: {} } })
    assert.equal(prompt.error.code, -32602)
    const unknownPromptArg = await fx.request({
      id: 51,
      jsonrpc: '2.0',
      method: 'prompts/get',
      params: { name: 'quiz-coach', arguments: { goal: 'improve', extra: 'no' } }
    })
    assert.equal(unknownPromptArg.error.code, -32602)
    const wrongPromptType = await fx.request({
      id: 52,
      jsonrpc: '2.0',
      method: 'prompts/get',
      params: { name: 'quiz-coach', arguments: { goal: 42 } }
    })
    assert.equal(wrongPromptType.error.code, -32602)
    const shutdown = await fx.request({ id: 6, jsonrpc: '2.0', method: 'shutdown' })
    assert.deepEqual(shutdown.result, {})
    await Promise.race([
      new Promise(resolve => fx.child.once('exit', resolve)),
      new Promise((_, reject) => setTimeout(() => reject(new Error('MCP child did not exit')), 1_000))
    ])
  } finally {
    await fx.close()
  }
})

test('exact web quiz contracts reach the broker unchanged', async () => {
  const fx = await fixture()
  try {
    await fx.request(init)
    const fetch = await fx.request({
      id: 2,
      jsonrpc: '2.0',
      method: 'tools/call',
      params: {
        name: 'qv_quiz_fetch',
        arguments: {
          source: 'request',
          kind: 'daily',
          mode: 'DailyQuiz',
          scope: 'global',
          topic: 'science',
          count: 2,
          id_prefix: 'daily',
          inline_questions: [{ id: 'q1', question: 'Q?', options: ['A', 'B'], correct_index: 0 }]
        }
      }
    })
    assert.equal(fetch.result.isError, false)
    const call = fx.calls.find(item => item.operation === 'read')
    assert.equal(call.rpc, 'quizverse_request_questions')
    assert.deepEqual(call.payload, {
      kind: 'daily',
      mode: 'DailyQuiz',
      scope: 'global',
      topic: 'science',
      count: 2,
      id_prefix: 'daily',
      inline_questions: [{ id: 'q1', question: 'Q?', options: ['A', 'B'], correct_index: 0 }]
    })
  } finally {
    await fx.close()
  }
})

test('MCP rejects malformed, unknown, and out-of-range fetch arguments before broker access', async () => {
  const fx = await fixture()
  try {
    await fx.request(init)
    for (const argumentsValue of [
      { ...QUIZ_FETCH_ROUTE_FIXTURES.weekly.args, iso_day: 8 },
      { ...QUIZ_FETCH_ROUTE_FIXTURES.news.args, invented: true },
      { ...QUIZ_FETCH_ROUTE_FIXTURES.external.args, provider: 'unknown' }
    ]) {
      const response = await fx.request({
        id: crypto.randomUUID(),
        jsonrpc: '2.0',
        method: 'tools/call',
        params: { arguments: argumentsValue, name: 'qv_quiz_fetch' }
      })
      assert.equal(response.error.code, -32602)
    }
    assert.equal(fx.calls.filter(item => item.operation === 'read').length, 0)
  } finally {
    await fx.close()
  }
})

test('writes require broker challenge and preserve exact submit contract', async () => {
  const fx = await fixture()
  try {
    await fx.request(init)
    const key = crypto.randomUUID()
    const args = {
      answers: [{ latency_ms: 500, question_id: 'q1', selected_index: 2 }],
      duration_ms: 1000,
      idempotency_key: key,
      mode: 'DailyQuiz',
      question_pack_id: 'pack-1'
    }
    const first = await fx.request({
      id: 2,
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: 'qv_quiz_submit', arguments: args }
    })
    const challenge = JSON.parse(first.result.content[0].text).data.approval_challenge
    assert.ok(challenge)
    assert.equal(fx.calls.some(call => call.operation === 'execute'), false)

    const second = await fx.request({
      id: 3,
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: 'qv_quiz_submit', arguments: { ...args, approval_challenge: challenge } }
    })
    const normalized = JSON.parse(second.result.content[0].text).data
    assert.equal(normalized.contractVersion, 'quiz-submit-v2')
    assert.equal(normalized.success, true)
    const execute = fx.calls.find(call => call.operation === 'execute')
    assert.equal(execute.rpc, 'quiz_submit_result_v2')
    assert.deepEqual(execute.payload, args)
  } finally {
    await fx.close()
  }
})

test('cancellation aborts an in-flight broker request', async () => {
  const fx = await fixture({ delayReads: true })
  try {
    await fx.request(init)
    const pending = fx.request({
      id: 22,
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: 'qv_profile_get', arguments: {} }
    })
    await new Promise(resolve => setTimeout(resolve, 25))
    fx.child.stdin.write(`${JSON.stringify({
      jsonrpc: '2.0',
      method: 'notifications/cancelled',
      params: { requestId: 22, reason: 'test cancellation' }
    })}\n`)
    const response = await pending
    assert.equal(response.error.code, -32800)
  } finally {
    await fx.close()
  }
})

test('ordinary broker calls have a bounded timeout', async () => {
  const fx = await fixture({ delayReads: true, timeoutMs: 25 })
  try {
    await fx.request(init)
    const response = await fx.request({
      id: 23,
      jsonrpc: '2.0',
      method: 'tools/call',
      params: { name: 'qv_profile_get', arguments: {} }
    })
    assert.equal(response.error.code, -32002)
  } finally {
    await fx.close()
  }
})

test('secretless relay reaches the Electron-managed socket server', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qv-mcp-relay-'))
  const serverSocket = socketPath(root).replace('qv-mcp-test-', 'qv-mcp-server-')
  const server = spawn(process.execPath, [SERVER.pathname], {
    env: {
      QUIZVERSE_MCP_BROKER_SECRET: crypto.randomBytes(48).toString('base64url'),
      QUIZVERSE_MCP_BROKER_SOCKET: path.join(root, 'unused-broker.sock'),
      QUIZVERSE_MCP_LISTEN_SOCKET: serverSocket
    },
    stdio: ['ignore', 'ignore', 'pipe']
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.stderr.setEncoding('utf8')
    server.stderr.on('data', chunk => {
      if (chunk.includes('QUIZVERSE_MCP_READY')) resolve()
    })
  })
  const relay = spawn(process.execPath, [RELAY.pathname], {
    env: { QUIZVERSE_MCP_SERVER_SOCKET: serverSocket },
    stdio: ['pipe', 'pipe', 'pipe']
  })
  const lines = []
  let output = ''
  relay.stdout.setEncoding('utf8')
  relay.stdout.on('data', chunk => {
    output += chunk
    let newline
    while ((newline = output.indexOf('\n')) >= 0) {
      lines.push(JSON.parse(output.slice(0, newline)))
      output = output.slice(newline + 1)
    }
  })
  const request = async message => {
    relay.stdin.write(`${JSON.stringify(message)}\n`)
    const deadline = Date.now() + 1_000
    while (Date.now() < deadline) {
      const found = lines.find(item => item.id === message.id)
      if (found) return found
      await new Promise(resolve => setTimeout(resolve, 5))
    }
    throw new Error('relay response timed out')
  }
  assert.equal((await request(init)).result.protocolVersion, '2025-03-26')
  assert.equal((await request({ id: 2, jsonrpc: '2.0', method: 'tools/list' })).result.tools.length, 27)
  const relayExited = new Promise(resolve => relay.once('exit', resolve))
  const serverExited = new Promise(resolve => server.once('exit', resolve))
  relay.kill('SIGTERM')
  server.kill('SIGTERM')
  await Promise.all([relayExited, serverExited])
  fs.rmSync(root, { force: true, recursive: true })
})

test('socket clients isolate initialization, cancellation, and shutdown', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qv-mcp-connections-'))
  const mcpSocket = process.platform === 'win32'
    ? `\\\\.\\pipe\\qv-mcp-server-${crypto.randomUUID()}`
    : path.join(root, 'mcp.sock')
  const brokerSocket = process.platform === 'win32'
    ? `\\\\.\\pipe\\qv-mcp-broker-${crypto.randomUUID()}`
    : path.join(root, 'broker.sock')
  const secret = crypto.randomBytes(48).toString('base64url')
  const broker = net.createServer(connection => {
    let text = ''
    connection.setEncoding('utf8')
    connection.on('data', chunk => {
      text += chunk
      const newline = text.indexOf('\n')
      if (newline < 0) return
      const request = JSON.parse(text.slice(0, newline))
      const result = request.operation === 'capability'
        ? { authKind: 'guest', playerId: 'guest-connection' }
        : normalizedFixture(request)
      const respond = () => connection.end(`${JSON.stringify({ id: request.id, ok: true, result })}\n`)
      if (request.operation === 'read') setTimeout(respond, 100)
      else respond()
    })
  })
  await new Promise((resolve, reject) => {
    broker.once('error', reject)
    broker.listen(brokerSocket, resolve)
  })
  const server = spawn(process.execPath, [SERVER.pathname], {
    env: {
      QUIZVERSE_MCP_BROKER_SECRET: secret,
      QUIZVERSE_MCP_BROKER_SOCKET: brokerSocket,
      QUIZVERSE_MCP_LISTEN_SOCKET: mcpSocket
    },
    stdio: ['ignore', 'ignore', 'pipe']
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.stderr.setEncoding('utf8')
    server.stderr.on('data', chunk => {
      if (chunk.includes('QUIZVERSE_MCP_READY')) resolve()
    })
  })
  const first = await socketClient(mcpSocket)
  const second = await socketClient(mcpSocket)
  t.after(async () => {
    first.close()
    second.close()
    if (server.exitCode === null) {
      const exited = new Promise(resolve => server.once('exit', resolve))
      server.kill('SIGTERM')
      await exited
    }
    if (broker.listening) await new Promise(resolve => broker.close(resolve))
    fs.rmSync(root, { force: true, recursive: true })
  })
  assert.equal((await first.request({ id: 1, jsonrpc: '2.0', method: 'initialize', params: init.params })).result.protocolVersion, '2025-03-26')
  assert.equal((await second.request({ id: 1, jsonrpc: '2.0', method: 'tools/list' })).error.code, -32002)
  await second.request({ id: 2, jsonrpc: '2.0', method: 'initialize', params: init.params })

  const firstRead = first.request({
    id: 9,
    jsonrpc: '2.0',
    method: 'resources/read',
    params: { uri: 'qv://player/profile' }
  })
  const secondRead = second.request({
    id: 9,
    jsonrpc: '2.0',
    method: 'resources/read',
    params: { uri: 'qv://player/profile' }
  })
  first.notify({
    jsonrpc: '2.0',
    method: 'notifications/cancelled',
    params: { requestId: 9 }
  })
  assert.ok((await firstRead).error)
  const secondResult = await secondRead
  assert.equal(secondResult.error, undefined, JSON.stringify(secondResult))
  assert.match(secondResult.result.contents[0].text, /fixture-guest/)

  assert.deepEqual((await first.request({ id: 10, jsonrpc: '2.0', method: 'shutdown' })).result, {})
  assert.equal((await second.request({ id: 10, jsonrpc: '2.0', method: 'tools/list' })).result.tools.length, 27)
})

test('Unity and web mutation fixtures map without invented payload keys', async () => {
  const fx = await fixture()
  try {
    await fx.request(init)
    const fixtures = [
      ['qv_quiz_sync_score', {
        correct: 8,
        device_id: 'desktop-device',
        leaderboard_id: 'quizverse_global',
        mode: 'DailyQuiz',
        score: 800,
        total: 10
      }, 'submit_score_and_sync', {
        correct: 8,
        device_id: 'desktop-device',
        game_id: 'quizverse',
        leaderboard_id: 'quizverse_global',
        mode: 'DailyQuiz',
        score: 800,
        total: 10
      }],
      ['qv_friend_invite', { message: 'Play?', targetUserId: 'user-2' }, 'send_friend_invite',
        { message: 'Play?', targetUserId: 'user-2' }],
      ['qv_friend_challenge', { challengeData: { mode: 'daily' }, friendUserId: 'user-2' },
        'send_friend_challenge', { challengeData: { mode: 'daily' }, friendUserId: 'user-2', gameId: 'quizverse' }],
      ['qv_async_create', { quizModeName: 'Daily Quiz', quizModeType: 2 },
        'async_challenge_create', { quizModeName: 'Daily Quiz', quizModeType: 2 }],
      ['qv_async_join', { shareCode: 'ABC123' }, 'async_challenge_join', { shareCode: 'ABC123' }],
      ['qv_async_submit', {
        correctAnswers: 8,
        score: 800,
        sessionId: 'session-1',
        timeTaken: 42,
        totalQuestions: 10
      }, 'async_challenge_submit', {
        correctAnswers: 8,
        score: 800,
        sessionId: 'session-1',
        timeTaken: 42,
        totalQuestions: 10
      }],
      ['qv_tournament_enter', { paid_via: 'balance', slug: 'weekly-cup' },
        'tournament_enter', { paid_via: 'balance', slug: 'weekly-cup' }],
      ['qv_reward_claim', {}, 'quizverse_claim_daily_reward', { gameID: 'quizverse' }],
      ['qv_party_create', { maxSize: 4 }, 'matchmaking_create_party',
        { gameId: 'quizverse', maxSize: 4 }],
      ['qv_party_join', { partyId: 'party-1' }, 'matchmaking_join_party',
        { gameId: 'quizverse', partyId: 'party-1' }]
    ]
    let id = 30
    for (const [name, input, rpc, expected] of fixtures) {
      const key = crypto.randomUUID()
      const preparedResponse = await fx.request({
        id: id++,
        jsonrpc: '2.0',
        method: 'tools/call',
        params: { name, arguments: { ...input, idempotency_key: key } }
      })
      const prepared = fx.calls.filter(call => call.operation === 'prepare').at(-1)
      assert.equal(prepared.rpc, rpc)
      const expectedPayload = ['submit_score_and_sync', 'async_challenge_create', 'async_challenge_submit', 'tournament_enter'].includes(rpc)
        ? { ...expected, idempotency_key: key }
        : expected
      assert.deepEqual(prepared.payload, expectedPayload)
      const approvalChallenge = preparedResponse.result.structuredContent.data.approval_challenge
      const executed = await fx.request({
        id: id++,
        jsonrpc: '2.0',
        method: 'tools/call',
        params: {
          name,
          arguments: { ...input, approval_challenge: approvalChallenge, idempotency_key: key }
        }
      })
      assert.deepEqual(executed.result.structuredContent, {
        data: validateAndNormalizeQuizverseResponse(name, RESPONSE_FIXTURES[name]),
        tool: name
      })
    }
  } finally {
    await fx.close()
  }
})

test('all read tools and quiz source fixtures produce normalized responses', async () => {
  const fx = await fixture()
  try {
    await fx.request(init)
    const fixtures = [
      ['qv_profile_get', {}, 'player_get_full_profile', {}],
      ['qv_stats_get', {}, 'get_player_stats', {}],
      ['qv_context_get', {}, 'quizverse_get_player_context', {}],
      ['qv_quiz_history', { cursor: 'next', limit: 20 }, 'quiz_get_history', { cursor: 'next', limit: 20 }],
      ['qv_quiz_stats', {}, 'quiz_get_stats', {}],
      ['qv_leaderboard_get', { limit: 50, scope: 'global' }, 'get_leaderboard',
        { game_id: 'quizverse', limit: 50, scope: 'global' }],
      ['qv_wallet_get', {}, 'wallet_get_balances', { gameId: 'quizverse' }],
      ['qv_entitlements_get', {}, 'quizverse_get_entitlements', {}],
      ['qv_friends_list', { cursor: 'next', limit: 100, state: 0 }, 'friends_list',
        { cursor: 'next', limit: 100, state: 0 }],
      ['qv_tournaments_list', { limit: 20 }, 'tournament_list', { limit: 20 }],
      ['qv_async_status', { sessionId: 'session-1' }, 'async_challenge_get', { sessionId: 'session-1' }],
      ['qv_knowledge_map', {}, 'quizverse_knowledge_map', { game_id: 'quizverse' }],
      ['qv_party_status', { ticketId: 'ticket-1' }, 'matchmaking_get_status',
        { gameId: 'quizverse', ticketId: 'ticket-1' }]
    ]
    const fetches = Object.values(QUIZ_FETCH_ROUTE_FIXTURES).map(item => [
      item.args,
      item.rpc,
      withoutSource(item.args),
      item.response
    ])
    let id = 100
    for (const [name, args, rpc, payload] of fixtures) {
      const response = await fx.request({
        id: id++,
        jsonrpc: '2.0',
        method: 'tools/call',
        params: { arguments: args, name }
      })
      assert.equal(response.result.isError, false)
      assert.deepEqual(response.result.structuredContent, {
        data: validateAndNormalizeQuizverseResponse(name, RESPONSE_FIXTURES[name]),
        tool: name
      })
      const call = fx.calls.filter(item => item.operation === 'read').at(-1)
      assert.equal(call.rpc, rpc)
      assert.deepEqual(call.payload, payload)
    }
    for (const [args, rpc, payload, rawResponse] of fetches) {
      const response = await fx.request({
        id: id++,
        jsonrpc: '2.0',
        method: 'tools/call',
        params: { arguments: args, name: 'qv_quiz_fetch' }
      })
      assert.deepEqual(response.result.structuredContent, {
        data: validateAndNormalizeQuizFetchResponse(rpc, payload, rawResponse),
        tool: 'qv_quiz_fetch'
      })
      const call = fx.calls.filter(item => item.operation === 'read').at(-1)
      assert.equal(call.rpc, rpc)
      assert.deepEqual(call.payload, payload)
    }
    for (const [name, args] of [
      ['qv_tutorx_progress', {}],
      ['qv_tutorx_sessions', { limit: 10, offset: 0 }]
    ]) {
      const response = await fx.request({
        id: id++,
        jsonrpc: '2.0',
        method: 'tools/call',
        params: { arguments: args, name }
      })
      assert.equal(response.result.isError, false)
      assert.deepEqual(response.result.structuredContent, {
        data: validateAndNormalizeQuizverseResponse(name, RESPONSE_FIXTURES[name]),
        tool: name
      })
    }
  } finally {
    await fx.close()
  }
})

async function socketClient(socketPath) {
  const socket = net.createConnection(socketPath)
  socket.setEncoding('utf8')
  const waiters = new Map()
  let buffer = ''
  socket.on('data', chunk => {
    buffer += chunk
    let newline
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const message = JSON.parse(buffer.slice(0, newline))
      buffer = buffer.slice(newline + 1)
      waiters.get(message.id)?.(message)
      waiters.delete(message.id)
    }
  })
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve)
    socket.once('error', reject)
  })

  return {
    close: () => socket.destroy(),
    notify: message => socket.write(`${JSON.stringify(message)}\n`),
    request: message => new Promise(resolve => {
      waiters.set(message.id, resolve)
      socket.write(`${JSON.stringify(message)}\n`)
    })
  }
}
