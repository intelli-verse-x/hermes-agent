import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { validateAndNormalizeQuizverseResponse } from '../../../packages/quizverse-mcp/response-contracts.mjs'
import { TOOLS } from '../../../packages/quizverse-mcp/server.mjs'
import {
  EXTERNAL_PROVIDER_FIXTURES,
  QUIZ_FETCH_ROUTE_FIXTURES,
  RESPONSE_FIXTURES,
  WEEKLY_RAW_JSON_FIXTURES,
  WEEKLY_RAW_JSON_NEGATIVE_FIXTURES
} from '../../../packages/quizverse-mcp/test/response-fixtures.mjs'

const {
  quizverseMcpSocketPath,
  startQuizverseMcpBroker,
  stopQuizverseMcpBroker
} = await import(new URL('./qv-mcp-broker.ts', import.meta.url).href)

function send(socketPath: string, request: Record<string, unknown>): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath)
    let text = ''
    socket.setEncoding('utf8')
    socket.on('connect', () => socket.write(`${JSON.stringify(request)}\n`))
    socket.on('data', chunk => {
      text += chunk
      const newline = text.indexOf('\n')

      if (newline >= 0) {resolve(JSON.parse(text.slice(0, newline)))}
    })
    socket.on('error', reject)
  })
}

function sendRaw(socketPath: string, line: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath)
    let text = ''

    socket.setEncoding('utf8')
    socket.on('connect', () => socket.write(`${line}\n`))
    socket.on('data', chunk => {
      text += chunk
      const newline = text.indexOf('\n')

      if (newline >= 0) {
        resolve(JSON.parse(text.slice(0, newline)))
      }
    })
    socket.on('error', reject)
  })
}

test('enforces and normalizes every routed quiz fetch contract', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qv-broker-fetch-'))

  const socketPath = process.platform === 'win32'
    ? `\\\\.\\pipe\\qv-broker-fetch-${crypto.randomUUID()}`
    : path.join(root, 'broker.sock')

  const secret = crypto.randomBytes(48).toString('base64url')
  const byRpc = new Map(Object.values(QUIZ_FETCH_ROUTE_FIXTURES).map(item => [item.rpc, item]))
  let weeklyResponse = QUIZ_FETCH_ROUTE_FIXTURES.weekly.response

  const server = await startQuizverseMcpBroker({
    auditPath: path.join(root, 'audit.jsonl'),
    handlers: {
      approve: async () => false,
      capability: async () => ({ authKind: 'guest', playerId: 'guest-1' }),
      rpc: async (name, payload) => name === 'quizverse_fetch_external_quiz'
        ? EXTERNAL_PROVIDER_FIXTURES[String(payload.provider)]
        : name === 'quizverse_weekly_fetch'
          ? weeklyResponse
          : byRpc.get(name)!.response,
      tutor: async () => ({})
    },
    idempotencyPath: path.join(root, 'idempotency.json'),
    secret,
    socketPath
  })

  t.after(() => {
    stopQuizverseMcpBroker(server, socketPath)
    fs.rmSync(root, { force: true, recursive: true })
  })

  let id = 1

  for (const [source, fixture] of Object.entries(QUIZ_FETCH_ROUTE_FIXTURES)) {
    const payload = Object.fromEntries(Object.entries(fixture.args).filter(([key]) => key !== 'source'))

    const response = await send(socketPath, {
      auth: secret,
      id: String(id++),
      operation: 'read',
      payload,
      rpc: fixture.rpc,
      tool: 'qv_quiz_fetch'
    })

    assert.equal(response.ok, true)

    const normalized = response.result as {
      contractVersion: string
      data: { provenance: { rpc: string }; route: string }
    }

    assert.equal(normalized.contractVersion, 'quiz-fetch-routed-v2')
    assert.equal(normalized.data.route, source)
    assert.equal(normalized.data.provenance.rpc, fixture.rpc)
  }

  for (const provider of Object.keys(EXTERNAL_PROVIDER_FIXTURES)) {
    const response = await send(socketPath, {
      auth: secret,
      id: String(id++),
      operation: 'read',
      payload: { provider },
      rpc: 'quizverse_fetch_external_quiz',
      tool: 'qv_quiz_fetch'
    })

    assert.equal(response.ok, true)
    assert.equal(
      (response.result as { data: { provenance: { provider: string } } }).data.provenance.provider,
      provider
    )

    if (provider === 'starwars') {
      const question = (response.result as {
        data: { questions: Array<{ correctIndex: number; options: string[]; prompt: string }> }
      }).data.questions[0]

      assert.match(question.prompt, /Luke Skywalker.*eyes.*Star Wars/i)
      assert.equal(question.options[question.correctIndex], 'Blue')
      assert.equal(question.options.filter(option => option === 'Blue').length, 1)
      assert.equal(new Set(question.options).size, 4)
    }
  }

  const weeklyPayload = withoutSource(QUIZ_FETCH_ROUTE_FIXTURES.weekly.args)

  for (const [fixtureName, raw] of Object.entries(WEEKLY_RAW_JSON_FIXTURES)) {
    weeklyResponse = { raw_json: JSON.stringify(raw) }

    const response = await send(socketPath, {
      auth: secret,
      id: String(id++),
      operation: 'read',
      payload: weeklyPayload,
      rpc: 'quizverse_weekly_fetch',
      tool: 'qv_quiz_fetch'
    })

    assert.equal(response.ok, true, fixtureName)
    assert.ok(
      (response.result as { data: { questions: unknown[] } }).data.questions.length > 0,
      fixtureName
    )
  }

  for (const [fixtureName, raw] of Object.entries(WEEKLY_RAW_JSON_NEGATIVE_FIXTURES)) {
    weeklyResponse = { raw_json: JSON.stringify(raw) }

    const response = await send(socketPath, {
      auth: secret,
      id: String(id++),
      operation: 'read',
      payload: weeklyPayload,
      rpc: 'quizverse_weekly_fetch',
      tool: 'qv_quiz_fetch'
    })

    assert.equal(response.ok, false, fixtureName)
    assert.match(String(response.error), /no supported question wrapper|no answerable questions/)
  }

  for (const [rpc, payload, expected] of [
    ['quizverse_weekly_fetch', { ...withoutSource(QUIZ_FETCH_ROUTE_FIXTURES.weekly.args), iso_week: 54 }, 'invalid'],
    ['quizverse_fetch_news_quiz', { lang: 'en', unknown: true }, 'not allowed'],
    ['quizverse_fetch_external_quiz', { provider: 'unknown' }, 'unsupported']
  ] as const) {
    const response = await send(socketPath, {
      auth: secret,
      id: String(id++),
      operation: 'read',
      payload,
      rpc,
      tool: 'qv_quiz_fetch'
    })

    assert.equal(response.ok, false)
    assert.match(String(response.error), new RegExp(expected))
  }
})

function withoutSource(args: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(args).filter(([key]) => key !== 'source'))
}

test('maps all native subdomain contracts through the broker exactly', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qv-broker-native-'))

  const socketPath = process.platform === 'win32'
    ? `\\\\.\\pipe\\qv-broker-native-${crypto.randomUUID()}`
    : path.join(root, 'broker.sock')

  const secret = crypto.randomBytes(48).toString('base64url')
  const tournamentPackIdempotencyKey = crypto.randomUUID()
  const tournamentPicksIdempotencyKey = crypto.randomUUID()

  const cases = [
    ['qv_tournament_get', { slug: 'weekly-cup' }, 'tournament_get', { slug: 'weekly-cup' }],
    ['qv_tournament_bracket', { slug: 'weekly-cup' }, 'tournament_bracket_state', { slug: 'weekly-cup' }],
    ['qv_tournament_leaderboard', { limit: 25, slug: 'weekly-cup', view: 'top' }, 'tournament_leaderboard_top', { limit: 25, slug: 'weekly-cup' }],
    ['qv_learning_track_get', { track_id: 'featured' }, 'learning_track_get', { track_id: 'featured' }],
    ['qv_words_duel_get', { exam: 'gre' }, 'quizverse_words_duel_get', { exam: 'gre' }],
    ['qv_live_events_list', { maxPages: 2, status: 'published' }, 'creator_event_list', { maxPages: 2, status: 'published' }],
    ['qv_live_event_get', { creatorId: 'creator-1', eventId: 'event-1' }, 'creator_event_get', { creatorId: 'creator-1', eventId: 'event-1' }],
    ['qv_tournament_submit_pack', {
      correct: 8,
      duration_ms: 12_000,
      idempotency_key: tournamentPackIdempotencyKey,
      pack_id: 'pack-1',
      slug: 'weekly-cup',
      total: 10
    }, 'tournament_submit_pack_result', {
      correct: 8,
      duration_ms: 12_000,
      idempotency_key: tournamentPackIdempotencyKey,
      pack_id: 'pack-1',
      slug: 'weekly-cup',
      total: 10
    }],
    ['qv_tournament_submit_picks', {
      idempotency_key: tournamentPicksIdempotencyKey,
      picks: [{ answer_id: 'a-1', question_id: 'q-1' }],
      slug: 'weekly-cup'
    }, 'tournament_submit_picks', {
      idempotency_key: tournamentPicksIdempotencyKey,
      picks: [{ answer_id: 'a-1', question_id: 'q-1' }],
      slug: 'weekly-cup'
    }],
    ['qv_words_duel_submit', {
      answers: [0, 1, 2, 3, 0, 1, 2, 3, 0, 1],
      elapsed_ms: 15_000,
      exam: 'gre',
      idempotency_key: crypto.randomUUID()
    }, 'quizverse_words_duel_submit', {
      answers: [0, 1, 2, 3, 0, 1, 2, 3, 0, 1],
      elapsed_ms: 15_000,
      exam: 'gre'
    }],
    ['qv_live_event_join', {
      creatorId: 'creator-1',
      deviceId: 'desktop-device-1',
      eventId: 'event-1',
      idempotency_key: crypto.randomUUID(),
      playerName: 'Player One'
    }, 'creator_event_spa_join', {
      creatorId: 'creator-1',
      deviceId: 'desktop-device-1',
      eventId: 'event-1',
      playerName: 'Player One'
    }],
    ['qv_live_event_submit', {
      answer: 'Mars',
      answers: [{ answer: 'Mars', elapsedMs: 1200, questionIdx: 0 }],
      creatorId: 'creator-1',
      deviceId: 'desktop-device-1',
      eventId: 'event-1',
      idempotency_key: crypto.randomUUID(),
      playerName: 'Player One'
    }, 'creator_event_submit', {
      answer: 'Mars',
      answers: [{ answer: 'Mars', elapsedMs: 1200, questionIdx: 0 }],
      creatorId: 'creator-1',
      deviceId: 'desktop-device-1',
      eventId: 'event-1',
      playerName: 'Player One'
    }]
  ] as const

  const calls: Array<{ name: string; payload: Record<string, unknown> }> = []

  const typedTools = TOOLS as Array<{
    map: (args: Record<string, unknown>) => { payload: Record<string, unknown>; rpc: string }
    name: string
    write?: boolean
  }>

  const toolByName = new Map(typedTools.map(tool => [tool.name, tool]))
  const toolByRpc = new Map(cases.map(([tool, , rpc]) => [rpc, tool]))

  const server = await startQuizverseMcpBroker({
    auditPath: path.join(root, 'audit.jsonl'),
    handlers: {
      approve: async () => true,
      capability: async () => ({ authKind: 'authenticated', playerId: 'player-1' }),
      rpc: async (name, payload) => {
        calls.push({ name, payload })

        return RESPONSE_FIXTURES[toolByRpc.get(name)!]
      },
      tutor: async () => ({})
    },
    idempotencyPath: path.join(root, 'idempotency.json'),
    secret,
    socketPath
  })

  t.after(() => {
    stopQuizverseMcpBroker(server, socketPath)
    fs.rmSync(root, { force: true, recursive: true })
  })

  let requestId = 0

  for (const [toolName, args, expectedRpc, expectedPayload] of cases) {
    const tool = toolByName.get(toolName)!
    const mapped = tool.map(args)
    assert.equal(mapped.rpc, expectedRpc, toolName)

    if (expectedPayload) {
      assert.deepEqual(mapped.payload, expectedPayload, toolName)
    }

    if (!tool.write) {
      const response = await send(socketPath, {
        auth: secret,
        id: String(requestId++),
        operation: 'read',
        payload: mapped.payload,
        rpc: mapped.rpc,
        tool: toolName
      })

      assert.equal(response.ok, true, `${toolName}: ${String(response.error ?? '')}`)
      assert.deepEqual(
        response.result,
        validateAndNormalizeQuizverseResponse(
          toolName,
          RESPONSE_FIXTURES[toolName],
          { payload: mapped.payload, rpc: mapped.rpc }
        ),
        `${toolName} response fixture`
      )

      continue
    }

    const idempotencyKey = String((args as Record<string, unknown>).idempotency_key)

    const prepared = await send(socketPath, {
      auth: secret,
      hardConfirmation: true,
      id: String(requestId++),
      idempotencyKey,
      operation: 'prepare',
      payload: mapped.payload,
      rpc: mapped.rpc,
      tool: toolName
    })

    assert.equal(prepared.ok, true, toolName)
    const challenge = (prepared.result as { approval_challenge: string }).approval_challenge

    const executed = await send(socketPath, {
      auth: secret,
      challenge,
      id: String(requestId++),
      idempotencyKey,
      operation: 'execute',
      payload: mapped.payload,
      rpc: mapped.rpc,
      tool: toolName
    })

    assert.equal(executed.ok, true, toolName)
    assert.deepEqual(
      executed.result,
      validateAndNormalizeQuizverseResponse(toolName, RESPONSE_FIXTURES[toolName]),
      `${toolName} response fixture`
    )
  }

  assert.equal(calls.length, cases.length)
})

test('authenticates clients and enforces broker-owned write approval', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qv-broker-'))

  const socketPath = process.platform === 'win32'
    ? `\\\\.\\pipe\\qv-broker-test-${crypto.randomUUID()}`
    : path.join(root, 'broker.sock')

  const secret = crypto.randomBytes(48).toString('base64url')
  const rpcCalls: unknown[] = []
  const approvals: Array<{ hardConfirmation: boolean }> = []

  const server = await startQuizverseMcpBroker({
    auditPath: path.join(root, 'audit.jsonl'),
    handlers: {
      approve: async request => {
        approvals.push(request)

        return true
      },
      capability: async () => ({ authKind: 'authenticated', playerId: 'player-1' }),
      rpc: async (name, payload) => {
        rpcCalls.push({ name, payload })

        const tool = name === 'tournament_enter' ? 'qv_tournament_enter' : 'qv_profile_get'

        return RESPONSE_FIXTURES[tool]
      },
      tutor: async () => RESPONSE_FIXTURES.qv_tutorx_progress
    },
    idempotencyPath: path.join(root, 'idempotency.json'),
    secret,
    socketPath
  })

  t.after(() => {
    stopQuizverseMcpBroker(server, socketPath)
    fs.rmSync(root, { force: true, recursive: true })
  })

  const denied = await send(socketPath, { id: '0', operation: 'capability' })
  assert.equal(denied.ok, false)
  assert.equal(denied.code, -32001)
  assert.equal((await sendRaw(socketPath, '{')).ok, false)

  const idempotencyKey = crypto.randomUUID()
  const payload = { idempotency_key: idempotencyKey, slug: 'weekly-cup', paid_via: 'balance' }

  const prepared = await send(socketPath, {
    auth: secret,
    hardConfirmation: true,
    id: '1',
    idempotencyKey,
    operation: 'prepare',
    payload,
    rpc: 'tournament_enter',
    tool: 'qv_tournament_enter'
  })

  assert.equal(prepared.ok, true)
  assert.equal(rpcCalls.length, 0)
  assert.equal(approvals[0].hardConfirmation, true)
  const challenge = (prepared.result as { approval_challenge: string }).approval_challenge

  const executed = await send(socketPath, {
    auth: secret,
    challenge,
    id: '2',
    idempotencyKey,
    operation: 'execute',
    payload,
    rpc: 'tournament_enter',
    tool: 'qv_tournament_enter'
  })

  assert.equal(executed.ok, true)
  assert.equal(rpcCalls.length, 1)
  assert.equal(fs.existsSync(path.join(root, 'idempotency.json')), true)

  const mismatch = await send(socketPath, {
    auth: secret,
    id: '3',
    idempotencyKey,
    operation: 'prepare',
    payload: { ...payload, slug: 'different' },
    rpc: 'tournament_enter',
    tool: 'qv_tournament_enter'
  })

  assert.equal(mismatch.ok, false)

  const rewardKey = crypto.randomUUID()

  const rewardPrepared = await send(socketPath, {
    auth: secret,
    id: 'reward',
    idempotencyKey: rewardKey,
    operation: 'prepare',
    payload: { gameID: 'quizverse' },
    rpc: 'quizverse_claim_daily_reward',
    tool: 'qv_reward_claim'
  })

  assert.equal(rewardPrepared.ok, true)
  assert.equal(approvals.at(-1)?.hardConfirmation, true)

  const concurrentKey = crypto.randomUUID()
  const concurrentPayload = { idempotency_key: concurrentKey, slug: 'concurrent', paid_via: 'balance' }

  const concurrentPrepared = await send(socketPath, {
    auth: secret,
    id: '4',
    idempotencyKey: concurrentKey,
    operation: 'prepare',
    payload: concurrentPayload,
    rpc: 'tournament_enter',
    tool: 'qv_tournament_enter'
  })

  const concurrentChallenge = (concurrentPrepared.result as { approval_challenge: string }).approval_challenge

  const execute = (id: string) => send(socketPath, {
    auth: secret,
    challenge: concurrentChallenge,
    id,
    idempotencyKey: concurrentKey,
    operation: 'execute',
    payload: concurrentPayload,
    rpc: 'tournament_enter',
    tool: 'qv_tournament_enter'
  })

  const executions = await Promise.all([execute('5'), execute('6')])

  assert.equal(executions.filter(response => response.ok).length, 1)
  assert.equal(executions.filter(response => !response.ok).length, 1)
})

test('rejects broader Play RPCs outside the dedicated tool policy', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qv-broker-'))

  const socketPath = process.platform === 'win32'
    ? `\\\\.\\pipe\\qv-broker-test-${crypto.randomUUID()}`
    : path.join(root, 'broker.sock')

  const secret = crypto.randomBytes(48).toString('base64url')

  const server = await startQuizverseMcpBroker({
    auditPath: path.join(root, 'audit.jsonl'),
    handlers: {
      approve: async () => false,
      capability: async () => ({ authKind: 'guest', playerId: 'guest-1' }),
      rpc: async () => 'invalid scalar response',
      tutor: async () => ({})
    },
    idempotencyPath: path.join(root, 'idempotency.json'),
    secret,
    socketPath
  })

  t.after(() => {
    stopQuizverseMcpBroker(server, socketPath)
    fs.rmSync(root, { force: true, recursive: true })
  })

  const response = await send(socketPath, {
    auth: secret,
    id: '1',
    operation: 'read',
    payload: {},
    rpc: 'admin_get_users',
    tool: 'qv_profile_get'
  })

  assert.equal(response.ok, false)

  const authGated = await send(socketPath, {
    auth: secret,
    id: 'auth-gate',
    operation: 'read',
    payload: { gameId: 'quizverse', ticketId: 'ticket' },
    rpc: 'matchmaking_get_status',
    tool: 'qv_party_status'
  })

  assert.equal(authGated.ok, false)
  assert.match(String(authGated.error), /authenticated/)

  const invalidResponse = await send(socketPath, {
    auth: secret,
    id: 'response',
    operation: 'read',
    payload: {},
    rpc: 'player_get_full_profile',
    tool: 'qv_profile_get'
  })

  assert.equal(invalidResponse.ok, false)
  assert.equal((await send(socketPath, {
    auth: 'wrong-secret-value-that-is-long-enough-to-compare',
    id: '2',
    operation: 'capability'
  })).ok, false)

  const idempotencyKey = crypto.randomUUID()

  const payload = {
    idempotency_key: idempotencyKey,
    quizModeName: 'Daily Quiz',
    quizModeType: 2
  }

  const denied = await send(socketPath, {
    auth: secret,
    id: '3',
    idempotencyKey,
    operation: 'prepare',
    payload,
    rpc: 'async_challenge_create',
    tool: 'qv_async_create'
  })

  const challenge = (denied.result as { approval_challenge: string }).approval_challenge

  const deniedExecution = await send(socketPath, {
    auth: secret,
    challenge,
    id: '4',
    idempotencyKey,
    operation: 'execute',
    payload,
    rpc: 'async_challenge_create',
    tool: 'qv_async_create'
  })

  assert.equal(deniedExecution.ok, false)

  const malformedKey = crypto.randomUUID()

  const malformed = await send(socketPath, {
    auth: secret,
    id: '5',
    idempotencyKey: malformedKey,
    operation: 'prepare',
    payload: {
      answers: [{ latency_ms: 'fast', question_id: 'q1', selected_index: 0 }],
      duration_ms: 10,
      idempotency_key: malformedKey,
      mode: 'DailyQuiz',
      question_pack_id: 'pack'
    },
    rpc: 'quiz_submit_result_v2',
    tool: 'qv_quiz_submit'
  })

  assert.equal(malformed.ok, false)
})

test('uses a short brand-scoped local socket path', () => {
  const socketPath = quizverseMcpSocketPath('/a/very/long/path/to/QuizVerse/user/data')
  assert.ok(socketPath.includes('quizverse-mcp-'))

  if (process.platform !== 'win32') {assert.ok(socketPath.length < 104)}
})

test('preserves pending crash state across restart and expires challenges', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qv-broker-restart-'))

  const socketPath = process.platform === 'win32'
    ? `\\\\.\\pipe\\qv-broker-restart-${crypto.randomUUID()}`
    : path.join(root, 'broker.sock')

  const secret = crypto.randomBytes(48).toString('base64url')
  const idempotencyPath = path.join(root, 'idempotency.json')
  const pendingKey = crypto.randomUUID()
  const pendingPayload = { idempotency_key: pendingKey, slug: 'pending', paid_via: 'balance' }
  const canonical = JSON.stringify(pendingPayload, Object.keys(pendingPayload).sort())

  const payloadHash = crypto.createHash('sha256')
    .update(`qv_tournament_enter\0${canonical}`)
    .digest('hex')

  fs.writeFileSync(idempotencyPath, JSON.stringify({
    [pendingKey]: {
      payloadHash,
      playerId: 'player-1',
      status: 'pending',
      tool: 'qv_tournament_enter'
    }
  }))
  let rpcCalls = 0

  const server = await startQuizverseMcpBroker({
    auditPath: path.join(root, 'audit.jsonl'),
    challengeTtlMs: 1,
    handlers: {
      approve: async () => {
        await new Promise(resolve => setTimeout(resolve, 20))

        return true
      },
      capability: async () => ({ authKind: 'authenticated', playerId: 'player-1' }),
      rpc: async () => {
        rpcCalls += 1

        return RESPONSE_FIXTURES.qv_tournament_enter
      },
      tutor: async () => ({})
    },
    idempotencyPath,
    secret,
    socketPath
  })

  t.after(() => {
    stopQuizverseMcpBroker(server, socketPath)
    fs.rmSync(root, { force: true, recursive: true })
  })

  const pending = await send(socketPath, {
    auth: secret,
    id: '1',
    idempotencyKey: pendingKey,
    operation: 'prepare',
    payload: pendingPayload,
    rpc: 'tournament_enter',
    tool: 'qv_tournament_enter'
  })

  assert.equal((pending.result as { idempotency_state: string }).idempotency_state, 'unknown')
  assert.equal(rpcCalls, 0)

  const expiringKey = crypto.randomUUID()
  const expiringPayload = { idempotency_key: expiringKey, slug: 'expires', paid_via: 'balance' }

  const prepared = await send(socketPath, {
    auth: secret,
    id: '2',
    idempotencyKey: expiringKey,
    operation: 'prepare',
    payload: expiringPayload,
    rpc: 'tournament_enter',
    tool: 'qv_tournament_enter'
  })

  const challenge = (prepared.result as { approval_challenge: string }).approval_challenge
  await new Promise(resolve => setTimeout(resolve, 5))

  const expired = await send(socketPath, {
    auth: secret,
    challenge,
    id: '3',
    idempotencyKey: expiringKey,
    operation: 'execute',
    payload: expiringPayload,
    rpc: 'tournament_enter',
    tool: 'qv_tournament_enter'
  })

  assert.equal(expired.ok, false)
  assert.equal(rpcCalls, 0)
})
