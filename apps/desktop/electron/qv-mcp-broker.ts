import crypto from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

import { QUIZVERSE_CONTRACTS } from '../../../packages/quizverse-mcp/contracts.mjs'
import { validateQuizFetchBrokerPayload } from '../../../packages/quizverse-mcp/quiz-fetch-contracts.mjs'
import { validateAndNormalizeQuizverseResponse } from '../../../packages/quizverse-mcp/response-contracts.mjs'

export interface QvMcpCapability {
  authKind: 'authenticated' | 'guest'
  playerId: string
}

export interface QvMcpBrokerHandlers {
  approve: (request: {
    challenge: string
    hardConfirmation: boolean
    payload: Record<string, unknown>
    tool: string
  }) => Promise<boolean>
  capability: () => Promise<QvMcpCapability>
  rpc: (name: string, payload: Record<string, unknown>) => Promise<unknown>
  tutor: (requestPath: string) => Promise<unknown>
}

export interface QvMcpBrokerOptions {
  auditPath: string
  challengeTtlMs?: number
  handlers: QvMcpBrokerHandlers
  idempotencyPath: string
  secret: string
  socketPath: string
}

interface BrokerRequest {
  auth?: string
  challenge?: string
  hardConfirmation?: boolean
  id?: string
  idempotencyKey?: string
  operation?: 'capability' | 'execute' | 'prepare' | 'read' | 'tutor'
  payload?: Record<string, unknown>
  rpc?: string
  tool?: string
  tutorPath?: string
}

interface ChallengeRecord {
  approved: boolean
  expiresAt: number
  hardConfirmation: boolean
  idempotencyKey: string
  payloadHash: string
  playerId: string
  rpc: string
  state: 'approved' | 'executing' | 'pending'
  tool: string
}

interface IdempotencyRecord {
  error?: string
  payloadHash: string
  playerId: string
  result?: unknown
  status: 'failed' | 'pending' | 'succeeded' | 'unknown'
  tool: string
}

interface ToolPolicy {
  allowedKeys: readonly string[]
  authenticated?: boolean
  hard?: boolean
  required: readonly string[]
  rpc?: string
  rpcs?: readonly string[]
  tutorPath?: RegExp
  write?: boolean
}

const MAX_REQUEST_BYTES = 1024 * 1024
const CHALLENGE_TTL_MS = 10 * 60_000
const GAME_ID = 'quizverse'
type FieldValidator = (value: unknown) => boolean
const stringValue: FieldValidator = value => typeof value === 'string'
const booleanValue: FieldValidator = value => typeof value === 'boolean'
const numberValue: FieldValidator = value => typeof value === 'number' && Number.isFinite(value)
const integerValue: FieldValidator = value => Number.isInteger(value)
const objectValue: FieldValidator = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const stringArray: FieldValidator = value => Array.isArray(value) && value.every(stringValue)

const FIELD_RULES: Record<string, FieldValidator> = {
  accuracy: value => numberValue(value) && (value as number) >= 0 && (value as number) <= 100,
  answer: stringValue,
  answers: value =>
    Array.isArray(value) &&
    ((value.length === 10 &&
      value.every(answer => integerValue(answer) && (answer as number) >= 0 && (answer as number) <= 3)) ||
      value.every(answer =>
        exactObject(
          answer,
          {
            latency_ms: value => integerValue(value) && (value as number) >= 0,
            question_id: stringValue,
            selected_index: value => integerValue(value) && (value as number) >= -1
          },
          ['latency_ms', 'question_id', 'selected_index']
        )
      ) ||
      value.every(answer =>
        exactObject(
          answer,
          {
            answer: stringValue,
            elapsedMs: value => integerValue(value) && (value as number) >= 0,
            questionIdx: value => integerValue(value) && (value as number) >= 0
          },
          ['answer', 'elapsedMs', 'questionIdx']
        )
      )),
  categoryId: stringValue,
  categoryName: stringValue,
  challengeData: objectValue,
  challengedDisplayName: stringValue,
  challengedUserId: stringValue,
  correct: value => integerValue(value) && (value as number) >= 0,
  correctAnswers: value => integerValue(value) && (value as number) >= 0,
  correlationId: value => stringValue(value) && (value as string).length <= 128,
  count: value => integerValue(value) && (value as number) >= 1 && (value as number) <= 50,
  country: value => stringValue(value) && (value as string).length >= 2 && (value as string).length <= 3,
  cursor: stringValue,
  creatorId: stringValue,
  device_id: stringValue,
  deviceId: stringValue,
  displayName: stringValue,
  duration_ms: value => integerValue(value) && (value as number) >= 0,
  elapsed_ms: value => integerValue(value) && (value as number) >= 0,
  email: stringValue,
  eventId: stringValue,
  exam: value => ['gre', 'gmat', 'ielts'].includes(String(value)),
  friendUserId: stringValue,
  gameID: value => value === GAME_ID,
  game_id: value => value === GAME_ID,
  gameId: value => value === GAME_ID,
  id_prefix: stringValue,
  idempotency_key: stringValue,
  inline_questions: value =>
    Array.isArray(value) &&
    value.every(question =>
      exactObject(
        question,
        {
          correct_index: value => integerValue(value) && (value as number) >= 0,
          explanation: stringValue,
          id: stringValue,
          media_url: stringValue,
          options: stringArray,
          question: stringValue,
          topic: stringValue
        },
        ['correct_index', 'id', 'options', 'question']
      )
    ),
  iso_day: value => integerValue(value) && (value as number) >= 1 && (value as number) <= 7,
  iso_week: value => integerValue(value) && (value as number) >= 1 && (value as number) <= 53,
  iso_year: value => integerValue(value) && (value as number) >= 2000 && (value as number) <= 9999,
  kind: stringValue,
  lang: stringValue,
  lang_code: stringValue,
  leaderboard_id: stringValue,
  limit: value => integerValue(value) && (value as number) >= 1 && (value as number) <= 500,
  honeypot_correct: value => integerValue(value) && (value as number) >= 0,
  honeypot_total: value => integerValue(value) && (value as number) >= 0,
  includePrivate: booleanValue,
  latency_ms: value => integerValue(value) && (value as number) >= 0,
  maxPages: value => integerValue(value) && (value as number) >= 1 && (value as number) <= 5,
  maxSize: value => integerValue(value) && (value as number) >= 2 && (value as number) <= 8,
  message: stringValue,
  mode: stringValue,
  paid_via: value => value === 'balance' || value === 'amoe',
  pack_id: stringValue,
  partyId: stringValue,
  picks: value =>
    Array.isArray(value) &&
    value.every(pick =>
      exactObject(pick, { answer_id: stringValue, question_id: stringValue }, ['answer_id', 'question_id'])
    ),
  playerEmail: stringValue,
  playerName: stringValue,
  playerDisplayName: stringValue,
  provider: stringValue,
  questionHistory: value =>
    Array.isArray(value) &&
    value.every(entry =>
      exactObject(
        entry,
        {
          category: stringValue,
          correct: booleanValue,
          time_ms: value => integerValue(value) && (value as number) >= 0
        },
        ['category', 'correct', 'time_ms']
      )
    ),
  question_pack_id: stringValue,
  quizConfig: objectValue,
  quizModeName: stringValue,
  quizModeType: value => integerValue(value) && (value as number) >= 0,
  scope: value => ['global', 'friends', 'league'].includes(String(value)),
  score: value => numberValue(value) && (value as number) >= 0,
  sessionId: stringValue,
  shareCode: stringValue,
  slug: stringValue,
  state: value => integerValue(value) && (value as number) >= 0 && (value as number) <= 3,
  status: value => ['published', 'live', 'ended'].includes(String(value)),
  targetUserId: stringValue,
  ticketId: stringValue,
  timeTaken: value => numberValue(value) && (value as number) >= 0,
  topic: stringValue,
  track_id: stringValue,
  total: value => integerValue(value) && (value as number) >= 1,
  totalQuestions: value => integerValue(value) && (value as number) >= 1,
  type: stringValue,
  view: value => ['around', 'top', 'friends', 'country', 'tier', 'activity'].includes(String(value)),
  withParticipantScan: booleanValue
}

const POLICIES = QUIZVERSE_CONTRACTS as Readonly<Record<string, ToolPolicy>>

function exactObject(value: unknown, fields: Record<string, FieldValidator>, required: readonly string[]): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }
  const record = value as Record<string, unknown>

  return (
    required.every(key => key in record) && Object.entries(record).every(([key, item]) => Boolean(fields[key]?.(item)))
  )
}

export function quizverseMcpSocketPath(userData: string): string {
  if (process.platform === 'win32') {
    const safe = crypto.createHash('sha256').update(userData).digest('hex').slice(0, 24)

    return `\\\\.\\pipe\\quizverse-mcp-${safe}`
  }

  return path.join(
    os.tmpdir(),
    `quizverse-mcp-${crypto.createHash('sha256').update(userData).digest('hex').slice(0, 24)}.sock`
  )
}

function timingSafeSecret(actual: unknown, expected: string): boolean {
  if (typeof actual !== 'string') {
    return false
  }

  const left = Buffer.from(actual)
  const right = Buffer.from(expected)

  return left.length === right.length && crypto.timingSafeEqual(left, right)
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(',')}]`
  }

  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
      .join(',')}}`
  }

  return JSON.stringify(value)
}

function payloadHash(tool: string, payload: Record<string, unknown>): string {
  return crypto
    .createHash('sha256')
    .update(`${tool}\0${canonical(payload)}`)
    .digest('hex')
}

function validate(policy: ToolPolicy, request: BrokerRequest): Record<string, unknown> {
  if (!request.tool || !POLICIES[request.tool] || policy !== POLICIES[request.tool]) {
    throw new Error('Unknown QuizVerse MCP tool')
  }

  if (request.rpc && ![policy.rpc, ...(policy.rpcs ?? [])].filter(Boolean).includes(request.rpc)) {
    throw new Error('RPC is outside the dedicated QuizVerse MCP allowlist')
  }

  const payload =
    request.payload && typeof request.payload === 'object' && !Array.isArray(request.payload)
      ? { ...request.payload }
      : {}

  for (const key of Object.keys(payload)) {
    if (!policy.allowedKeys.includes(key)) {
      throw new Error(`Payload key is not allowed: ${key}`)
    }
  }

  for (const key of policy.required) {
    if (payload[key] === undefined || payload[key] === null || payload[key] === '') {
      throw new Error(`Required payload key is missing: ${key}`)
    }
  }

  for (const [key, value] of Object.entries(payload)) {
    const validator = FIELD_RULES[key]

    if (!validator || !validator(value)) {
      throw new Error(`Payload value is invalid: ${key}`)
    }
  }

  if (policy.write) {
    const key = request.idempotencyKey

    if (
      typeof key !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key) ||
      (payload.idempotency_key !== undefined && payload.idempotency_key !== key)
    ) {
      throw new Error('A matching RFC UUID idempotency key is required')
    }
  }

  if (request.tool === 'qv_quiz_fetch') {
    validateQuizFetchBrokerPayload(request.rpc, payload)
  }

  if (request.tool === 'qv_friends_list' && payload.state !== undefined) {
    if (!Number.isInteger(payload.state) || (payload.state as number) < 0 || (payload.state as number) > 3) {
      throw new Error('Friend state must be a numeric Nakama state from 0 through 3')
    }
  }

  if ('game_id' in payload) {
    payload.game_id = GAME_ID
  }

  if ('gameId' in payload) {
    payload.gameId = GAME_ID
  }

  if ('gameID' in payload) {
    payload.gameID = GAME_ID
  }

  return payload
}

function validateResponse(
  tool: string,
  result: unknown,
  context: { payload?: Record<string, unknown>; rpc?: string } = {}
): unknown {
  if (!result || typeof result !== 'object' || (Array.isArray(result) && tool !== 'qv_quiz_fetch')) {
    throw new Error(`${tool} returned a non-object response`)
  }

  if (JSON.stringify(result).match(/"(?:access_token|refresh_token|password|secret)"\s*:/i)) {
    throw new Error(`${tool} returned a forbidden credential field`)
  }

  validateJsonValue(result, 0)

  if (Buffer.byteLength(JSON.stringify(result), 'utf8') > MAX_REQUEST_BYTES) {
    throw new Error(`${tool} returned an oversized response`)
  }

  return validateAndNormalizeQuizverseResponse(tool, result, context)
}

function validateJsonValue(value: unknown, depth: number): void {
  if (depth > 12) {
    throw new Error('Response nesting exceeds the contract limit')
  }

  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  ) {
    return
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      validateJsonValue(item, depth + 1)
    }

    return
  }

  if (value && typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>)) {
      validateJsonValue(item, depth + 1)
    }

    return
  }

  throw new Error('Response contains a non-JSON contract value')
}

function readIdempotency(filePath: string): Record<string, IdempotencyRecord> {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'))

    if (!parsed || typeof parsed !== 'object') {
      return {}
    }

    return Object.fromEntries(
      Object.entries(parsed).map(([key, value]) => {
        const record = value as IdempotencyRecord

        return [key, { ...record, status: record.status || ('result' in record ? 'succeeded' : 'unknown') }]
      })
    )
  } catch {
    return {}
  }
}

function atomicWrite(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const temporary = `${filePath}.${process.pid}.tmp`
  fs.writeFileSync(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600 })
  fs.renameSync(temporary, filePath)
}

export function startQuizverseMcpBroker(options: QvMcpBrokerOptions): Promise<net.Server> {
  const { auditPath, challengeTtlMs = CHALLENGE_TTL_MS, handlers, idempotencyPath, secret, socketPath } = options

  if (secret.length < 32) {
    throw new Error('QuizVerse MCP broker secret is too short')
  }

  if (process.platform !== 'win32') {
    try {
      fs.unlinkSync(socketPath)
    } catch {
      /* missing stale socket */
    }
  }

  const challenges = new Map<string, ChallengeRecord>()
  const idempotency = readIdempotency(idempotencyPath)
  const rates = new Map<string, number[]>()

  const server = net.createServer(socket => {
    socket.setEncoding('utf8')
    let buffer = ''
    socket.on('data', chunk => {
      buffer += chunk

      if (Buffer.byteLength(buffer, 'utf8') > MAX_REQUEST_BYTES) {
        socket.destroy(new Error('QuizVerse MCP broker request is too large'))

        return
      }

      const newline = buffer.indexOf('\n')

      if (newline < 0) {
        return
      }
      const line = buffer.slice(0, newline)
      buffer = ''

      void (async () => {
        let request: BrokerRequest = {}

        try {
          request = JSON.parse(line) as BrokerRequest

          if (!timingSafeSecret(request.auth, secret)) {
            throw Object.assign(new Error('Unauthorized QuizVerse MCP broker request'), { code: -32001 })
          }

          const capability = await handlers.capability()
          const policy = request.tool ? POLICIES[request.tool] : undefined
          const kind = policy?.write ? 'write' : 'read'
          rateLimit(rates, `${capability.playerId}:${kind}`, kind === 'write' ? 10 : 60)
          let result: unknown

          if (request.operation === 'capability') {
            result = capability
          } else if (!policy) {
            throw new Error('Unknown QuizVerse MCP tool')
          } else if (policy.authenticated && capability.authKind !== 'authenticated') {
            throw new Error(`${request.tool} requires an authenticated QuizVerse account`)
          } else if (request.operation === 'tutor' && policy.tutorPath) {
            if (!request.tutorPath || !policy.tutorPath.test(request.tutorPath)) {
              throw new Error('TutorX path is not allowed')
            }
            result = validateResponse(request.tool!, await handlers.tutor(request.tutorPath))
          } else if (request.operation === 'read' && !policy.write) {
            const payload = validate(policy, request)
            result = validateResponse(request.tool!, await handlers.rpc(request.rpc || policy.rpc || '', payload), {
              payload,
              rpc: request.rpc || policy.rpc
            })
          } else if (request.operation === 'prepare' && policy.write) {
            const payload = validate(policy, request)
            const hash = payloadHash(request.tool!, payload)
            const existing = idempotency[request.idempotencyKey || '']

            if (
              existing &&
              (existing.playerId !== capability.playerId ||
                existing.tool !== request.tool ||
                existing.payloadHash !== hash)
            ) {
              throw new Error('Idempotency key was already bound to different input')
            }

            if (existing) {
              if (existing.status === 'succeeded') {
                result = { already_executed: true, result: existing.result }
              } else {
                result = {
                  idempotency_state: existing.status === 'pending' ? 'unknown' : existing.status,
                  message:
                    existing.error || 'The prior mutation outcome requires reconciliation; it will not be retried.'
                }
              }
            } else {
              const challenge = crypto.randomBytes(32).toString('base64url')

              const record: ChallengeRecord = {
                approved: false,
                expiresAt: Number.POSITIVE_INFINITY,
                hardConfirmation: Boolean(policy.hard || request.hardConfirmation),
                idempotencyKey: request.idempotencyKey || '',
                payloadHash: hash,
                playerId: capability.playerId,
                rpc: request.rpc || policy.rpc || '',
                state: 'pending',
                tool: request.tool!
              }

              challenges.set(challenge, record)
              record.approved = await handlers.approve({
                challenge,
                hardConfirmation: record.hardConfirmation,
                payload,
                tool: request.tool!
              })
              record.state = record.approved ? 'approved' : 'pending'
              record.expiresAt = Date.now() + challengeTtlMs
              result = {
                approval_challenge: challenge,
                approved: record.approved,
                confirmation_required: true,
                expires_at: new Date(record.expiresAt).toISOString()
              }
            }
          } else if (request.operation === 'execute' && policy.write) {
            const payload = validate(policy, request)
            const record = challenges.get(request.challenge || '')

            if (!record || !record.approved || record.state !== 'approved' || record.expiresAt < Date.now()) {
              throw new Error('Approval challenge is invalid, denied, expired, or already consumed')
            }
            const hash = payloadHash(request.tool!, payload)

            if (
              record.playerId !== capability.playerId ||
              record.tool !== request.tool ||
              record.idempotencyKey !== request.idempotencyKey ||
              record.payloadHash !== hash
            ) {
              throw new Error('Approval challenge does not match this player, tool, or payload')
            }

            record.state = 'executing'
            challenges.delete(request.challenge || '')
            const existing = idempotency[record.idempotencyKey]

            if (existing) {
              if (
                existing.payloadHash !== hash ||
                existing.playerId !== capability.playerId ||
                existing.tool !== request.tool
              ) {
                throw new Error('Idempotency key was already bound to different input')
              }

              if (existing.status !== 'succeeded') {
                throw new Error('The idempotency key has a pending, failed, or unknown outcome and will not be retried')
              }

              result = existing.result
            } else {
              idempotency[record.idempotencyKey] = {
                payloadHash: hash,
                playerId: capability.playerId,
                status: 'pending',
                tool: request.tool!
              }
              atomicWrite(idempotencyPath, idempotency)

              try {
                result = validateResponse(request.tool!, await handlers.rpc(record.rpc, payload))
                idempotency[record.idempotencyKey] = {
                  payloadHash: hash,
                  playerId: capability.playerId,
                  result,
                  status: 'succeeded',
                  tool: request.tool!
                }
              } catch (error) {
                idempotency[record.idempotencyKey] = {
                  error: error instanceof Error ? error.message.slice(0, 300) : 'Mutation failed with unknown outcome',
                  payloadHash: hash,
                  playerId: capability.playerId,
                  status: 'unknown',
                  tool: request.tool!
                }
                atomicWrite(idempotencyPath, idempotency)
                throw error
              }

              atomicWrite(idempotencyPath, idempotency)
            }
          } else {
            throw new Error('Operation does not match the dedicated tool policy')
          }

          appendAudit(auditPath, {
            ok: true,
            operation: request.operation,
            player_id: capability.playerId,
            tool: request.tool
          })
          socket.end(`${JSON.stringify({ id: request.id, ok: true, result })}\n`)
        } catch (error) {
          appendAudit(auditPath, {
            error: error instanceof Error ? error.message.slice(0, 160) : 'broker failure',
            ok: false,
            operation: request.operation,
            tool: request.tool
          })
          socket.end(
            `${JSON.stringify({
              code: typeof (error as { code?: unknown })?.code === 'number' ? (error as { code: number }).code : -32003,
              error: error instanceof Error ? error.message.slice(0, 300) : 'QuizVerse broker request failed',
              id: request.id,
              ok: false
            })}\n`
          )
        }
      })()
    })
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(socketPath, () => {
      server.off('error', reject)

      if (process.platform !== 'win32') {
        fs.chmodSync(socketPath, 0o600)
      }
      resolve(server)
    })
  })
}

function appendAudit(filePath: string, event: Record<string, unknown>): void {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.appendFileSync(filePath, `${JSON.stringify({ ...event, at: new Date().toISOString() })}\n`, {
      encoding: 'utf8',
      mode: 0o600
    })
  } catch {
    // Audit failures never expose request payloads or credentials.
  }
}

function rateLimit(rates: Map<string, number[]>, key: string, limit: number): void {
  const now = Date.now()
  const current = (rates.get(key) ?? []).filter(timestamp => now - timestamp < 60_000)

  if (current.length >= limit) {
    throw new Error('QuizVerse MCP broker rate limit exceeded')
  }
  current.push(now)
  rates.set(key, current)
}

export function stopQuizverseMcpBroker(server: net.Server | null, socketPath: string): void {
  server?.close()

  if (process.platform !== 'win32') {
    try {
      fs.unlinkSync(socketPath)
    } catch {
      /* already removed */
    }
  }
}
