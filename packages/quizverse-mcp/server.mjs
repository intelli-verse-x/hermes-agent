#!/usr/bin/env node
import crypto from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import readline from 'node:readline'

import { QUIZVERSE_CONTRACTS } from './contracts.mjs'
import {
  mapQuizFetchRequest,
  QUIZ_FETCH_INPUT_SCHEMA,
  validateQuizFetchRequest
} from './quiz-fetch-contracts.mjs'

const SUPPORTED_PROTOCOLS = ['2025-03-26', '2024-11-05']
const DEFAULT_TIMEOUT_MS = Number(process.env.QUIZVERSE_MCP_TIMEOUT_MS) || 12_000
const APPROVAL_TIMEOUT_MS = 10 * 60_000
const brokerSocket = process.env.QUIZVERSE_MCP_BROKER_SOCKET || ''
const brokerSecret = process.env.QUIZVERSE_MCP_BROKER_SECRET || ''
const GAME_ID = 'quizverse'

const str = (description, extra = {}) => ({ description, type: 'string', ...extra })
const integer = (description, extra = {}) => ({ description, type: 'integer', ...extra })
const number = (description, extra = {}) => ({ description, type: 'number', ...extra })
const array = (description, items = { type: 'object' }) => ({ description, items, type: 'array' })
const object = (properties = {}, required = []) => ({
  additionalProperties: false,
  properties,
  required,
  type: 'object'
})
const outputSchema = object(
  {
    data: { description: 'Normalized RPC or API response.', type: ['array', 'boolean', 'null', 'number', 'object', 'string'] },
    tool: str('QuizVerse MCP tool name.')
  },
  ['data', 'tool']
)
const idempotency = {
  approval_challenge: str('Server-issued approval challenge for the second call.'),
  idempotency_key: str('RFC UUID retained across retries.', { format: 'uuid' })
}
const writeSchema = (properties, required) =>
  object({ ...properties, ...idempotency }, [...required, 'idempotency_key'])

const answerSchema = object(
  {
    latency_ms: integer('Answer latency in milliseconds.', { minimum: 0 }),
    question_id: str('Server-issued question id.'),
    selected_index: integer('Selected option index; -1 means unanswered.', { minimum: -1 })
  },
  ['question_id', 'selected_index', 'latency_ms']
)

const TOOLS = [
  read('qv_profile_get', 'Read the current QuizVerse player profile.', 'player_get_full_profile', object()),
  read('qv_stats_get', 'Read player scores, streaks, and progression stats.', 'get_player_stats', object()),
  read('qv_context_get', 'Read the player personalization context.', 'quizverse_get_player_context', object()),
  {
    description: 'Fetch questions using an exact QuizVerse source contract.',
    inputSchema: QUIZ_FETCH_INPUT_SCHEMA,
    map: mapQuizFetchRequest,
    name: 'qv_quiz_fetch'
  },
  read('qv_quiz_history', 'Read paginated quiz history.', 'quiz_get_history', object({
    cursor: str('Opaque history cursor.'),
    limit: integer('Page size.', { maximum: 100, minimum: 1 })
  })),
  read('qv_quiz_stats', 'Read aggregate quiz performance.', 'quiz_get_stats', object()),
  {
    description: 'Read a QuizVerse leaderboard.',
    inputSchema: object({
      limit: integer('Maximum rows.', { maximum: 100, minimum: 1 }),
      scope: str('Leaderboard scope.', { enum: ['global', 'friends', 'league'] })
    }, ['scope']),
    map: args => route('get_leaderboard', { game_id: GAME_ID, scope: args.scope, limit: args.limit ?? 50 }),
    name: 'qv_leaderboard_get'
  },
  {
    description: 'Read player wallet balances.',
    inputSchema: object(),
    map: () => route('wallet_get_balances', { gameId: GAME_ID }),
    name: 'qv_wallet_get',
    requiresAuthenticated: true
  },
  read('qv_entitlements_get', 'Read product entitlements.', 'quizverse_get_entitlements', object(), true),
  read('qv_friends_list', 'Read paginated friends by numeric state.', 'friends_list', object({
    cursor: str('Opaque pagination cursor.'),
    limit: integer('Page size.', { maximum: 500, minimum: 1 }),
    state: integer('Nakama friend state: 0 friend, 1 sent, 2 received, 3 blocked.', { maximum: 3, minimum: 0 })
  }), true),
  read('qv_tournaments_list', 'Read active tournaments.', 'tournament_list', object({
    cursor: str('Opaque pagination cursor.'),
    limit: integer('Page size.', { maximum: 100, minimum: 1 })
  })),
  {
    description: 'Read an async challenge by session or share code.',
    inputSchema: object({ sessionId: str('Challenge session id.'), shareCode: str('Challenge share code.') }),
    map: args => {
      if (!args.sessionId && !args.shareCode) throw invalid('sessionId or shareCode is required')
      return route('async_challenge_get', pick(args, ['sessionId', 'shareCode']))
    },
    name: 'qv_async_status'
  },
  {
    description: 'Read the player knowledge map.',
    inputSchema: object(),
    map: () => route('quizverse_knowledge_map', { game_id: GAME_ID }),
    name: 'qv_knowledge_map'
  },
  tutor('qv_tutorx_progress', 'Read TutorX learning progress.', '/api/v1/learning/progress', object()),
  {
    description: 'Read recent TutorX study sessions.',
    inputSchema: object({
      limit: integer('Page size.', { maximum: 100, minimum: 1 }),
      offset: integer('Page offset.', { minimum: 0 })
    }),
    map: args => ({ method: 'GET', tutorPath: `/api/v1/sessions?limit=${args.limit ?? 50}&offset=${args.offset ?? 0}` }),
    name: 'qv_tutorx_sessions'
  },
  write('qv_quiz_submit', 'Submit a server-issued question pack.', 'quiz_submit_result_v2',
    writeSchema({
      answers: array('Per-question answers.', answerSchema),
      duration_ms: integer('Total quiz duration.', { minimum: 0 }),
      mode: str('QuizVerse mode enum name.'),
      question_pack_id: str('Server-issued question pack id.')
    }, ['question_pack_id', 'mode', 'duration_ms', 'answers'])),
  {
    description: 'Synchronize score and leaderboard state.',
    inputSchema: writeSchema({
      correct: integer('Correct answer count.', { minimum: 0 }),
      device_id: str('Desktop player device id.'),
      leaderboard_id: str('Leaderboard id.'),
      mode: str('QuizVerse mode enum name.'),
      score: number('Score.', { minimum: 0 }),
      total: integer('Total question count.', { minimum: 1 })
    }, ['leaderboard_id', 'device_id', 'mode', 'score', 'correct', 'total']),
    map: args => route('submit_score_and_sync', { ...withoutControl(args, true), game_id: GAME_ID }),
    name: 'qv_quiz_sync_score',
    write: true
  },
  write('qv_friend_invite', 'Send a friend invite.', 'send_friend_invite',
    writeSchema({ message: str('Optional invite message.'), targetUserId: str('Exact target player id.') }, ['targetUserId']), true),
  {
    description: 'Send a QuizVerse friend challenge.',
    inputSchema: writeSchema({
      challengeData: { additionalProperties: true, description: 'Server challenge metadata.', type: 'object' },
      correlationId: str('Optional client correlation id.', { maxLength: 128 }),
      friendUserId: str('Exact friend player id.')
    }, ['friendUserId']),
    map: args => route('send_friend_challenge', {
      friendUserId: args.friendUserId,
      gameId: GAME_ID,
      challengeData: args.challengeData ?? {},
      ...(args.correlationId ? { correlationId: args.correlationId } : {})
    }),
    name: 'qv_friend_challenge',
    requiresAuthenticated: true,
    write: true
  },
  write('qv_async_create', 'Create an async challenge.', 'async_challenge_create',
    writeSchema({
      challengedDisplayName: str('Optional challenged player display name.'),
      challengedUserId: str('Optional challenged player id.'),
      playerDisplayName: str('Creator display name.'),
      quizConfig: { additionalProperties: true, description: 'Quiz mode configuration.', type: 'object' },
      quizModeName: str('Quiz mode name.'),
      quizModeType: integer('Quiz mode enum value.', { minimum: 0 })
    }, ['quizModeType', 'quizModeName'])),
  write('qv_async_join', 'Join an async challenge.', 'async_challenge_join',
    writeSchema({ playerDisplayName: str('Joining player display name.'), shareCode: str('Challenge share code.') }, ['shareCode'])),
  write('qv_async_submit', 'Submit an async challenge result.', 'async_challenge_submit',
    writeSchema({
      accuracy: number('Accuracy percentage.', { maximum: 100, minimum: 0 }),
      categoryId: str('Category id.'),
      categoryName: str('Category name.'),
      correctAnswers: integer('Correct answer count.', { minimum: 0 }),
      questionHistory: array('Per-question category history.'),
      score: integer('Final score.', { minimum: 0 }),
      sessionId: str('Challenge session id.'),
      timeTaken: number('Total seconds.', { minimum: 0 }),
      totalQuestions: integer('Total question count.', { minimum: 1 })
    }, ['sessionId', 'score', 'correctAnswers', 'totalQuestions', 'timeTaken'])),
  write('qv_tournament_enter', 'Enter a tournament using an approved payment path.', 'tournament_enter',
    writeSchema({ paid_via: str('Entry payment path.', { enum: ['balance', 'amoe'] }), slug: str('Tournament slug.') }, ['slug', 'paid_via']), true, true),
  {
    description: 'Claim the current earned daily reward.',
    hardConfirmation: true,
    inputSchema: writeSchema({}, []),
    map: () => route('quizverse_claim_daily_reward', { gameID: GAME_ID }),
    name: 'qv_reward_claim',
    requiresAuthenticated: true,
    write: true
  },
  {
    description: 'Create a QuizVerse matchmaking party.',
    inputSchema: writeSchema({ maxSize: integer('Maximum party size.', { maximum: 8, minimum: 2 }) }, ['maxSize']),
    map: args => route('matchmaking_create_party', {
      gameId: GAME_ID,
      maxSize: args.maxSize
    }),
    name: 'qv_party_create',
    requiresAuthenticated: true,
    write: true
  },
  {
    description: 'Join a QuizVerse matchmaking party.',
    inputSchema: writeSchema({ partyId: str('Party id.') }, ['partyId']),
    map: args => route('matchmaking_join_party', {
      gameId: GAME_ID,
      partyId: args.partyId
    }),
    name: 'qv_party_join',
    requiresAuthenticated: true,
    write: true
  },
  {
    description: 'Read a QuizVerse matchmaking ticket status.',
    inputSchema: object({ ticketId: str('Matchmaking ticket id.') }, ['ticketId']),
    map: args => route('matchmaking_get_status', { gameId: GAME_ID, ticketId: args.ticketId }),
    name: 'qv_party_status',
    requiresAuthenticated: true
  }
]

function read(name, description, rpc, inputSchema, requiresAuthenticated = false) {
  return { description, inputSchema, map: args => route(rpc, args), name, requiresAuthenticated }
}
function tutor(name, description, tutorPath, inputSchema) {
  return { description, inputSchema, map: () => ({ method: 'GET', tutorPath }), name }
}
function write(name, description, rpc, inputSchema, requiresAuthenticated = false, hardConfirmation = false) {
  const upstreamIdempotency = new Set([
    'async_challenge_create',
    'async_challenge_submit',
    'quiz_submit_result_v2',
    'submit_score_and_sync',
    'tournament_enter'
  ]).has(rpc)
  return {
    description,
    hardConfirmation,
    inputSchema,
    map: args => route(rpc, withoutControl(args, upstreamIdempotency)),
    name,
    requiresAuthenticated,
    write: true
  }
}
function route(rpc, payload) {
  return { payload, rpc }
}
function pick(source, keys) {
  return Object.fromEntries(keys.filter(key => source[key] !== undefined).map(key => [key, source[key]]))
}
function withoutControl(args, keepIdempotency = false) {
  const payload = { ...args }
  const idempotencyKey = payload.idempotency_key
  delete payload.approval_challenge
  delete payload.idempotency_key
  if (keepIdempotency) payload.idempotency_key = idempotencyKey
  return payload
}
function invalid(message) {
  return new McpError(-32602, message)
}

const TOOL_BY_NAME = new Map(TOOLS.map(tool => [tool.name, tool]))
const RESOURCES = [
  { description: 'Current player profile.', mimeType: 'application/json', name: 'player-profile', uri: 'qv://player/profile' },
  { description: 'Supported player modes.', mimeType: 'application/json', name: 'modes-catalog', uri: 'qv://modes/catalog' },
  { description: 'Active tournaments.', mimeType: 'application/json', name: 'active-tournaments', uri: 'qv://tournaments/active' },
  { description: 'Recent TutorX sessions.', mimeType: 'application/json', name: 'tutorx-sessions', uri: 'qv://tutorx/sessions' }
]
const PROMPTS = [
  { arguments: [{ name: 'goal', required: true }], description: 'Coach with current player context.', name: 'quiz-coach' },
  { arguments: [{ name: 'topic', required: false }], description: 'Review progress and propose a study plan.', name: 'study-plan-review' },
  { arguments: [{ name: 'question_pack_id', required: true }], description: 'Debrief a completed quiz.', name: 'post-quiz-debrief' }
]

function createConnectionState() {
  return {
    capabilities: {},
    inFlight: new Map(),
    initialized: false,
    protocolVersion: null,
    shuttingDown: false
  }
}

const standaloneState = createConnectionState()

class McpError extends Error {
  constructor(code, message, data) {
    super(message)
    this.code = code
    this.data = data
  }
}

function validateInput(schema, value) {
  if (schema.oneOf) {
    try {
      validateQuizFetchRequest(value)
    } catch (error) {
      throw invalid(error instanceof Error ? error.message : String(error))
    }
    return
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid('Tool arguments must be an object')
  for (const name of schema.required || []) {
    if (value[name] === undefined || value[name] === null || value[name] === '') throw invalid(`Missing required argument: ${name}`)
  }
  for (const name of Object.keys(value)) {
    if (schema.additionalProperties === false && !(name in schema.properties)) throw invalid(`Unknown argument: ${name}`)
  }
  for (const [name, rule] of Object.entries(schema.properties || {})) {
    const item = value[name]
    if (item === undefined) continue
    if (rule.type === 'array' && !Array.isArray(item)) throw invalid(`${name} must be an array`)
    if (rule.type === 'object' && (!item || typeof item !== 'object' || Array.isArray(item))) throw invalid(`${name} must be an object`)
    if (rule.type === 'integer' && !Number.isInteger(item)) throw invalid(`${name} must be an integer`)
    if (rule.type === 'number' && typeof item !== 'number') throw invalid(`${name} must be a number`)
    if (rule.type === 'string' && typeof item !== 'string') throw invalid(`${name} must be a string`)
    if (rule.enum && !rule.enum.includes(item)) throw invalid(`${name} is not allowed`)
    if (typeof item === 'number' && rule.minimum !== undefined && item < rule.minimum) throw invalid(`${name} is below minimum`)
    if (typeof item === 'number' && rule.maximum !== undefined && item > rule.maximum) throw invalid(`${name} exceeds maximum`)
  }
}

function brokerRequest(request, signal) {
  if (!brokerSocket || !brokerSecret) throw new McpError(-32001, 'QuizVerse desktop broker is unavailable')
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(brokerSocket)
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new McpError(-32002, 'QuizVerse desktop broker timed out'))
    }, request.operation === 'prepare' ? APPROVAL_TIMEOUT_MS : DEFAULT_TIMEOUT_MS)
    let text = ''
    const cleanup = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
    }
    const abort = () => {
      socket.destroy()
      cleanup()
      reject(new McpError(-32800, 'Request cancelled'))
    }
    signal?.addEventListener('abort', abort, { once: true })
    socket.setEncoding('utf8')
    socket.on('connect', () => socket.write(`${JSON.stringify({
      ...request, auth: brokerSecret, id: crypto.randomUUID()
    })}\n`))
    socket.on('data', chunk => {
      text += chunk
      const newline = text.indexOf('\n')
      if (newline < 0) return
      cleanup()
      socket.end()
      try {
        const response = JSON.parse(text.slice(0, newline))
        if (!response.ok) reject(new McpError(response.code || -32003, response.error || 'Broker request failed'))
        else resolve(response.result)
      } catch (error) {
        reject(error instanceof McpError ? error : new McpError(-32700, 'Invalid broker response'))
      }
    })
    socket.on('error', error => {
      cleanup()
      reject(new McpError(-32004, `QuizVerse desktop broker is offline: ${error.message}`))
    })
  })
}

function normalizeResponse(value) {
  if (!value || typeof value !== 'object') {
    throw new McpError(-32003, 'Broker returned a non-object contract response')
  }

  return value
}

async function callTool(name, args = {}, signal) {
  const tool = TOOL_BY_NAME.get(name)
  if (!tool) throw invalid(`Unknown QuizVerse tool: ${name}`)
  const contract = QUIZVERSE_CONTRACTS[name]
  if (!contract) throw invalid(`Missing shared QuizVerse contract: ${name}`)
  validateInput(tool.inputSchema, args)
  if (args.idempotency_key && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(args.idempotency_key)) {
    throw invalid('idempotency_key must be an RFC UUID')
  }
  const mapped = tool.map(args)
  if (mapped.rpc && ![contract.rpc, ...(contract.rpcs || [])].filter(Boolean).includes(mapped.rpc)) {
    throw invalid(`Mapped RPC is outside the shared QuizVerse contract: ${mapped.rpc}`)
  }
  const capability = await brokerRequest({ operation: 'capability' }, signal)
  if (tool.requiresAuthenticated && capability.authKind !== 'authenticated') {
    throw new McpError(-32010, `${name} requires an authenticated QuizVerse account`)
  }
  if (!tool.write) {
    return normalizeResponse(await brokerRequest({
      operation: mapped.tutorPath ? 'tutor' : 'read',
      payload: mapped.payload,
      rpc: mapped.rpc,
      tool: name,
      tutorPath: mapped.tutorPath
    }, signal))
  }
  if (!args.approval_challenge) {
    return brokerRequest({
      hardConfirmation: Boolean(tool.hardConfirmation),
      idempotencyKey: args.idempotency_key,
      operation: 'prepare',
      payload: mapped.payload,
      rpc: mapped.rpc,
      tool: name
    }, signal)
  }
  return normalizeResponse(await brokerRequest({
    challenge: args.approval_challenge,
    idempotencyKey: args.idempotency_key,
    operation: 'execute',
    payload: mapped.payload,
    rpc: mapped.rpc,
    tool: name
  }, signal))
}

/**
 * @param {string} method
 * @param {Record<string, any>} params
 * @param {AbortSignal | undefined} signal
 */
async function handle(method, params = {}, signal, state = standaloneState) {
  if (state.shuttingDown && method !== 'shutdown') throw new McpError(-32000, 'Connection is shutting down')
  if (method === 'initialize') {
    if (
      !params ||
      typeof params !== 'object' ||
      typeof params.protocolVersion !== 'string' ||
      !params.clientInfo ||
      typeof params.clientInfo.name !== 'string' ||
      typeof params.clientInfo.version !== 'string' ||
      !params.capabilities ||
      typeof params.capabilities !== 'object' ||
      Array.isArray(params.capabilities)
    ) throw invalid('initialize requires protocolVersion, clientInfo name/version, and capabilities')
    if (!SUPPORTED_PROTOCOLS.includes(params.protocolVersion)) {
      throw new McpError(-32602, `Unsupported protocol version: ${params.protocolVersion}`)
    }
    state.initialized = true
    state.protocolVersion = params.protocolVersion
    state.capabilities = { ...params.capabilities }
    return {
      capabilities: { prompts: {}, resources: {}, tools: {} },
      protocolVersion: params.protocolVersion,
      serverInfo: { name: 'quizverse-player', version: '0.1.0' }
    }
  }
  if (method === 'ping') return {}
  if (method === 'shutdown') {
    state.shuttingDown = true
    for (const controller of state.inFlight.values()) controller.abort()
    return {}
  }
  if (!state.initialized) throw new McpError(-32002, 'Server connection is not initialized')
  if (method === 'tools/list') {
    return {
      tools: TOOLS.map(({ description, inputSchema, name }) => ({
        description,
        inputSchema,
        name,
        outputSchema
      }))
    }
  }
  if (method === 'tools/call') {
    if (!params || typeof params.name !== 'string') throw invalid('Tool name is required')
    const result = await callTool(params.name, params.arguments || {}, signal)
    const normalized = { data: result, tool: params.name }
    return {
      content: [{ text: JSON.stringify(normalized), type: 'text' }],
      isError: false,
      structuredContent: normalized
    }
  }
  if (method === 'resources/list') return { resources: RESOURCES }
  if (method === 'resources/read') {
    if (!params || typeof params.uri !== 'string') throw invalid('Resource uri is required')
    const routes = {
      'qv://player/profile': ['qv_profile_get', {}],
      'qv://tournaments/active': ['qv_tournaments_list', {}],
      'qv://tutorx/sessions': ['qv_tutorx_sessions', {}]
    }
    const result = params.uri === 'qv://modes/catalog'
      ? { modes: ['daily', 'weekly', 'news', 'movies', 'music', 'async', 'party', 'tournament', 'tutorx'] }
      : routes[params.uri]
        ? await callTool(routes[params.uri][0], routes[params.uri][1], signal)
        : (() => { throw invalid(`Unknown resource: ${params.uri}`) })()
    return { contents: [{ mimeType: 'application/json', text: JSON.stringify(result), uri: params.uri }] }
  }
  if (method === 'prompts/list') return { prompts: PROMPTS }
  if (method === 'prompts/get') {
    if (!params || typeof params.name !== 'string') throw invalid('Prompt name is required')
    const prompt = PROMPTS.find(item => item.name === params.name)
    if (!prompt) throw invalid(`Unknown prompt: ${params.name}`)
    const values = params.arguments && typeof params.arguments === 'object' ? params.arguments : {}
    const allowed = new Set(prompt.arguments.map(argument => argument.name))
    for (const [name, value] of Object.entries(values)) {
      if (!allowed.has(name)) throw invalid(`Unknown prompt argument: ${name}`)
      if (typeof value !== 'string') throw invalid(`Prompt argument ${name} must be a string`)
    }
    for (const arg of prompt.arguments) if (arg.required && !values[arg.name]) throw invalid(`Missing prompt argument: ${arg.name}`)
    const subject = Object.values(values).filter(Boolean).join(' — ')
    const guidance = {
      'post-quiz-debrief': 'Review the completed quiz, explain mistakes, and suggest focused practice. Do not mutate game state.',
      'quiz-coach': 'Coach with current player data. Ask before any action that changes game state.',
      'study-plan-review': 'Review learning progress and propose a small, achievable study plan.'
    }[params.name]
    return { description: prompt.description, messages: [{ content: { text: `${guidance}${subject ? `\nContext: ${subject}` : ''}`, type: 'text' }, role: 'user' }] }
  }
  throw new McpError(-32601, `Method not found: ${method}`)
}

export async function dispatch(message, signal, state = standaloneState) {
  if (!message || typeof message !== 'object' || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    throw new McpError(-32600, 'Invalid JSON-RPC request')
  }
  return handle(message.method, message.params, signal, state)
}
export { TOOLS }

function serve(inputStream, write, close, exitProcessOnShutdown = false) {
  const state = createConnectionState()
  const input = readline.createInterface({ input: inputStream, crlfDelay: Infinity })
  const send = payload => write(`${JSON.stringify(payload)}\n`)
  input.on('line', line => {
    let message
    try {
      message = JSON.parse(line)
    } catch {
      send({ error: { code: -32700, message: 'Parse error' }, id: null, jsonrpc: '2.0' })
      return
    }
    if (
      !message ||
      typeof message !== 'object' ||
      Array.isArray(message) ||
      message.jsonrpc !== '2.0' ||
      typeof message.method !== 'string'
    ) {
      send({
        error: { code: -32600, message: 'Invalid JSON-RPC request' },
        id: message && typeof message === 'object' && 'id' in message ? message.id : null,
        jsonrpc: '2.0'
      })
      return
    }
    if (message?.method === 'notifications/cancelled') {
      state.inFlight.get(message.params?.requestId)?.abort()
      return
    }
    if (message?.method?.startsWith('notifications/')) return
    if (message?.id === undefined) {
      void dispatch(message, undefined, state).catch(() => {})
      return
    }
    const controller = new AbortController()
    state.inFlight.set(message.id, controller)
    void dispatch(message, controller.signal, state)
      .then(result => {
        send({ id: message.id, jsonrpc: '2.0', result })
        if (message.method === 'shutdown') {
          setTimeout(() => {
            close()
            if (exitProcessOnShutdown) process.exit(0)
          }, 0)
        }
      })
      .catch(error => send({
        error: {
          code: error instanceof McpError ? error.code : -32603,
          ...(error instanceof McpError && error.data !== undefined ? { data: error.data } : {}),
          message: error instanceof Error ? error.message : 'Internal error'
        },
        id: message.id ?? null,
        jsonrpc: '2.0'
      }))
      .finally(() => state.inFlight.delete(message.id))
  })
  return { input, state }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const listenSocket = process.env.QUIZVERSE_MCP_LISTEN_SOCKET || ''
  const connections = new Set()
  let transportServer

  if (listenSocket) {
    if (process.platform !== 'win32') {
      try { fs.unlinkSync(listenSocket) } catch { /* no stale socket */ }
    }
    transportServer = net.createServer(socket => {
      const connection = serve(socket, text => socket.write(text), () => socket.end())
      connections.add(connection)
      socket.once('close', () => connections.delete(connection))
    })
    transportServer.listen(listenSocket, () => {
      if (process.platform !== 'win32') fs.chmodSync(listenSocket, 0o600)
      process.stderr.write('QUIZVERSE_MCP_READY\n')
    })
  } else {
    connections.add(serve(process.stdin, text => process.stdout.write(text), () => process.stdin.destroy(), true))
  }

  process.on('SIGTERM', () => {
    for (const connection of connections) {
      connection.state.shuttingDown = true
      for (const controller of connection.state.inFlight.values()) controller.abort()
      connection.input.close()
    }
    transportServer?.close()
    if (listenSocket && process.platform !== 'win32') {
      try { fs.unlinkSync(listenSocket) } catch { /* already removed */ }
    }
    setTimeout(() => process.exit(0), 25)
  })
}
