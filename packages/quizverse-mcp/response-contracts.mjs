import {
  QUIZ_FETCH_ROUTES,
  validateAndNormalizeQuizFetchResponse
} from './quiz-fetch-contracts.mjs'

const string = { type: 'string' }
const boolean = { type: 'boolean' }
const number = { type: 'number' }
const integer = (minimum = 0, maximum) => ({ maximum, minimum, type: 'integer' })
const nullable = schema => ({ anyOf: [schema, { type: 'null' }] })
const enumeration = values => ({ enum: values })
const array = items => ({ items, type: 'array' })
const object = (properties, required = [], additionalProperties = false) => ({
  additionalProperties,
  properties,
  required,
  type: 'object'
})
const jsonObject = { additionalProperties: true, properties: {}, type: 'object' }

const player = object({
  displayName: string,
  display_name: string,
  isComplete: boolean,
  score: integer(),
  skillLevel: integer(),
  status: string,
  userId: string,
  username: string
}, [], true)
const question = object({
  c: integer(),
  cat: string,
  correct_answer: integer(),
  d: string,
  difficulty: string,
  e: string,
  explanation: string,
  o: array(string),
  options: array(string),
  q: string,
  question: string
}, [], true)
const asyncSession = object({
  createdAt: integer(),
  expiresAt: integer(),
  finalResult: nullable(jsonObject),
  gameId: string,
  playerA: player,
  playerB: nullable(player),
  questions: array(question),
  quizConfig: jsonObject,
  quizModeName: string,
  quizModeType: integer(),
  sessionId: string,
  shareCode: string,
  status: integer(0, 4)
}, ['sessionId', 'shareCode', 'status'], true)
const successError = { error: nullable(string), success: boolean }
const okError = { error: nullable(string), ok: boolean }

export const QUIZVERSE_RESPONSE_CONTRACTS = Object.freeze({
  qv_profile_get: unionContract('full-profile-v1', [
    object({
      ...successError,
      gameId: string,
      profile: object({
        avatarUrl: string,
        badges: jsonObject,
        league: jsonObject,
        level: integer(),
        stats: jsonObject,
        totalXp: number,
        userId: string,
        username: string,
        wallet: jsonObject,
        xp: integer(),
        xpToNextLevel: integer()
      }, ['userId', 'username', 'level', 'stats', 'league', 'wallet'], true),
      timestamp: string
    }, ['success', 'profile', 'gameId', 'timestamp']),
    object({
      ...successError,
      profile: object({
        avatarUrl: string,
        displayName: string,
        league: jsonObject,
        level: integer(),
        stats: jsonObject,
        totalXp: number,
        userId: string
      }, ['userId', 'displayName'], true)
    }, ['success', 'profile'])
  ], value => value.profile),
  qv_stats_get: envelopeContract('player-stats-v1', 'data', object({
    avatarUrl: string,
    averageScore: number,
    bestStreak: integer(),
    currentStreak: integer(),
    displayName: string,
    favoriteCategory: string,
    lastPlayedAt: integer(),
    totalCorrectAnswers: integer(),
    totalGamesPlayed: integer(),
    totalQuestions: integer(),
    userId: string,
    winRate: number
  }, [
    'userId', 'totalGamesPlayed', 'totalCorrectAnswers', 'totalQuestions',
    'winRate', 'currentStreak', 'bestStreak', 'averageScore',
    'favoriteCategory', 'lastPlayedAt'
  ])),
  qv_context_get: unionContract('quizverse-context-v1', [
    object({
      ...okError,
      pack: object({
        activity: object({
          abandon_7d: integer(),
          completion_7d: integer(),
          last_quiz_ms: integer()
        }, ['last_quiz_ms', 'completion_7d', 'abandon_7d'], true),
        affinity: object({ topics: array(string) }, ['topics'], true),
        country: string,
        device: string,
        experiments: array(jsonObject),
        flags: jsonObject,
        issued_ms: integer(),
        locale: string,
        safety: object({ level: string }, ['level'], true),
        tier: string,
        user_id: string,
        version: enumeration(['v1'])
      }, [
        'version', 'user_id', 'issued_ms', 'locale', 'country', 'device',
        'tier', 'affinity', 'activity', 'flags', 'experiments', 'safety'
      ])
    }, ['ok', 'pack']),
    object({ ...successError, context: jsonObject }, ['success', 'context'])
  ], value => value.pack ?? value.context),
  qv_quiz_fetch: Object.freeze({
    routes: QUIZ_FETCH_ROUTES,
    version: 'quiz-fetch-routed-v2'
  }),
  qv_quiz_history: envelopeContract('quiz-history-v1', 'data', object({
    cursor: string,
    results: array(object({
      category: string,
      correctAnswers: integer(),
      score: number,
      timestamp: integer(),
      totalQuestions: integer()
    }, ['score', 'totalQuestions', 'correctAnswers', 'timestamp']))
  }, ['results', 'cursor'])),
  qv_quiz_stats: envelopeContract('quiz-stats-v1', 'data', object({
    averageScore: number,
    lastPlayedAt: integer(),
    totalCorrect: integer(),
    totalGames: integer(),
    totalQuestions: integer()
  }, ['totalGames', 'totalCorrect', 'totalQuestions', 'averageScore', 'lastPlayedAt'])),
  qv_leaderboard_get: unionContract('leaderboard-v1', [
    object({ ...successError, records: array(player), nextCursor: nullable(string) }, ['success', 'records'], true),
    object({ ...successError, data: object({ records: array(player), nextCursor: nullable(string) }, ['records'], true) }, ['success', 'data'])
  ], value => value.data ?? { nextCursor: value.nextCursor ?? null, records: value.records }),
  qv_wallet_get: envelopeContract('arcade-wallet-v1', 'data', object({
    conversion: object({
      canConvert: boolean,
      globalEquivalent: integer(),
      minConvertAmount: number,
      ratio: number
    }, ['ratio', 'globalEquivalent', 'canConvert', 'minConvertAmount']),
    currencies: { additionalProperties: number, properties: {}, type: 'object' },
    game_balance: integer(),
    gameId: string,
    global_balance: integer(),
    timestamp: string,
    userId: string
  }, [
    'userId', 'gameId', 'game_balance', 'global_balance', 'currencies',
    'conversion', 'timestamp'
  ])),
  qv_entitlements_get: envelopeContract('entitlements-v1', 'data', object({
    consumables: jsonObject,
    one_time: jsonObject,
    subscriptions: jsonObject
  }, [], true)),
  qv_friends_list: unionContract('friends-phase4-v1', [
    object({
      ...successError,
      data: object({
        count: integer(),
        friends: array(player),
        nextCursor: nullable(string),
        results: array(player)
      }, ['count'], true)
    }, ['success', 'data']),
    object({
      ...successError,
      count: integer(),
      friends: array(player),
      nextCursor: nullable(string),
      timestamp: string,
      userId: string
    }, ['success', 'friends', 'count'], true)
  ], value => value.data ?? {
    count: value.count,
    nextCursor: value.nextCursor ?? null,
    results: value.friends
  }),
  qv_tournaments_list: envelopeContract('tournament-list-v1', 'data', object({
    count: integer(),
    nextCursor: nullable(string),
    tournaments: array(jsonObject)
  }, ['tournaments'], true)),
  qv_async_status: sessionContract('async-unity-session-v1'),
  qv_knowledge_map: contract('knowledge-map-v1', object({
    categories: { additionalProperties: object({
      accuracy_pct: integer(0, 100),
      avg_time_ms: integer(),
      correct: integer(),
      strength_level: enumeration(['weak', 'moderate', 'strong', 'expert']),
      total_questions: integer()
    }, ['total_questions', 'correct', 'accuracy_pct', 'avg_time_ms', 'strength_level']), type: 'object' },
    error: nullable(string),
    overall_coverage_pct: integer(0, 100),
    strongest: nullable(string),
    success: boolean,
    total_quizzes: integer(),
    weakest: nullable(string)
  }, ['success', 'categories', 'overall_coverage_pct', 'total_quizzes']), value => value),
  qv_tutorx_progress: unionContract('tutorx-progress-v1', [
    array(jsonObject),
    object({ items: array(jsonObject) }, ['items'])
  ], value => Array.isArray(value) ? { items: value } : value),
  qv_tutorx_sessions: contract('tutorx-sessions-v1', object({
    sessions: array(jsonObject),
    total: integer()
  }, ['sessions'], true), value => value),
  qv_quiz_submit: contract('quiz-submit-v2', object({
    correct: integer(),
    graded: array(object({
      correct_index: integer(-1),
      is_correct: boolean,
      latency_ms: integer(),
      question_id: string,
      scored_server: boolean,
      selected_index: integer()
    }, ['question_id', 'selected_index', 'correct_index', 'is_correct', 'latency_ms', 'scored_server'])),
    ok: boolean,
    score: integer(),
    scoring_version: enumeration(['v2']),
    total: integer(),
    v1_persisted: boolean,
    v1_result: jsonObject
  }, ['ok', 'score', 'correct', 'total', 'scoring_version', 'graded', 'v1_persisted', 'v1_result']), value => value),
  qv_quiz_sync_score: contract('score-sync-v1', object({
    bonuses: array(jsonObject),
    game_id: string,
    leaderboards_updated: array(string),
    reward_currency: string,
    reward_details: jsonObject,
    reward_earned: integer(),
    score: integer(),
    success: boolean,
    wallet_balance: integer()
  }, [
    'success', 'score', 'reward_earned', 'reward_currency', 'reward_details',
    'bonuses', 'wallet_balance', 'leaderboards_updated', 'game_id'
  ]), value => value),
  qv_friend_invite: contract('friend-invite-v1', object({
    error: nullable(string),
    inviteId: string,
    status: enumeration(['pending', 'sent', 'accepted']),
    success: boolean,
    targetUserId: string
  }, ['success']), value => value),
  qv_friend_challenge: contract('friend-challenge-phase3a-v1', object({
    challengeId: string,
    correlationId: nullable(string),
    error: nullable(string),
    errorCode: nullable(string),
    expiresAt: string,
    fromUserId: string,
    gameId: string,
    isAsync: boolean,
    retryAfterMs: integer(),
    roomCode: nullable(string),
    shareCode: nullable(string),
    status: string,
    success: boolean,
    timestamp: string,
    toUserId: string
  }, ['success']), value => value),
  qv_async_create: sessionContract('async-unity-create-v1'),
  qv_async_join: sessionContract('async-unity-join-v1'),
  qv_async_submit: sessionContract('async-unity-submit-v1'),
  qv_tournament_enter: envelopeContract('tournament-entry-v1', 'data', jsonObject),
  qv_reward_claim: envelopeContract('arcade-daily-reward-v1', 'data', object({
    nextReward: integer(),
    rewardAmount: integer(),
    streak: integer(1)
  }, ['rewardAmount', 'streak', 'nextReward'])),
  qv_party_create: contract('matchmaking-party-create-v1', object({
    createdAt: string,
    error: nullable(string),
    leaderId: string,
    maxSize: integer(2, 8),
    partyId: string,
    success: boolean
  }, ['success', 'partyId', 'leaderId', 'maxSize']), value => value),
  qv_party_join: contract('matchmaking-party-join-v1', object({
    error: nullable(string),
    maxSize: integer(2, 8),
    memberCount: integer(),
    members: array(player),
    partyId: string,
    success: boolean
  }, ['success', 'partyId', 'memberCount', 'maxSize', 'members']), value => value),
  qv_party_status: contract('matchmaking-status-v1', object({
    error: nullable(string),
    matchId: nullable(string),
    players: array(player),
    searchTimeSeconds: integer(),
    status: enumeration(['searching', 'matched', 'cancelled', 'expired']),
    success: boolean,
    ticketId: string
  }, ['success', 'ticketId', 'status', 'players']), value => value)
})

export function validateAndNormalizeQuizverseResponse(tool, value, context = {}) {
  const contract = QUIZVERSE_RESPONSE_CONTRACTS[tool]
  if (!contract) throw new Error(`Missing response contract for ${tool}`)
  if (tool === 'qv_quiz_fetch') {
    return validateAndNormalizeQuizFetchResponse(context.rpc, context.payload ?? {}, value)
  }
  if (value && typeof value === 'object' && !Array.isArray(value) && value.ok === false) {
    validateSchema(object({
      error: string,
      fallback_to_client: boolean,
      message: string,
      ok: boolean,
      rpc: string,
      source_trace: jsonObject
    }, ['ok', 'error'], false), value, '$')

    return {
      contractVersion: contract.version,
      data: {
        error: value.error,
        fallback_to_client: value.fallback_to_client,
        source_trace: value.source_trace
      },
      success: false
    }
  }
  if (value && typeof value === 'object' && !Array.isArray(value) && value.success === false) {
    validateSchema(object({
      error: string,
      errorCode: string,
      retryAfterMs: integer(),
      success: boolean
    }, ['success', 'error']), value, '$')

    return {
      contractVersion: contract.version,
      data: { error: value.error, errorCode: value.errorCode, retryAfterMs: value.retryAfterMs },
      success: false
    }
  }
  const failures = []

  for (const schema of contract.schemas) {
    try {
      validateSchema(schema, value, '$')
      const data = contract.normalize(value)

      return {
        contractVersion: contract.version,
        data,
        success: value && typeof value === 'object' && !Array.isArray(value)
          ? ('success' in value ? value.success : ('ok' in value ? value.ok : true))
          : true
      }
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error))
    }
  }
  throw new Error(`${tool} response violates ${contract.version}: ${failures.join(' | ')}`)
}

function contract(version, schema, normalize) {
  const normalizer = typeof normalize === 'function' ? normalize : value => value[normalize]
  return Object.freeze({ normalize: normalizer, schemas: [schema], version })
}

function unionContract(version, schemas, normalize) {
  return Object.freeze({ normalize, schemas, version })
}

function envelopeContract(version, key, dataSchema) {
  return contract(version, object({ ...successError, [key]: dataSchema }, ['success', key]), key)
}

function sessionContract(version) {
  return unionContract(version, [
    object({ ...successError, session: asyncSession }, ['success', 'session']),
    object({ ...successError, data: asyncSession }, ['success', 'data']),
    object({ ...successError, ...asyncSession.properties }, ['success', ...asyncSession.required], true)
  ], value => value.session ?? value.data ?? value)
}

function validateSchema(schema, value, path) {
  if (schema.anyOf) {
    const errors = []
    for (const candidate of schema.anyOf) {
      try {
        validateSchema(candidate, value, path)
        return
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error))
      }
    }
    throw new Error(`${path} did not match a compatible variant: ${errors.join(', ')}`)
  }
  if (schema.enum && !schema.enum.includes(value)) throw new Error(`${path} must be one of ${schema.enum.join(', ')}`)
  if (schema.type === 'null') {
    if (value !== null) throw new Error(`${path} must be null`)
    return
  }
  if (schema.type === 'string' && typeof value !== 'string') throw new Error(`${path} must be a string`)
  if (schema.type === 'boolean' && typeof value !== 'boolean') throw new Error(`${path} must be a boolean`)
  if (schema.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) throw new Error(`${path} must be finite`)
  if (schema.type === 'integer') {
    if (!Number.isInteger(value)) throw new Error(`${path} must be an integer`)
    if (schema.minimum !== undefined && value < schema.minimum) throw new Error(`${path} is below minimum`)
    if (schema.maximum !== undefined && value > schema.maximum) throw new Error(`${path} exceeds maximum`)
  }
  if (schema.type === 'array') {
    if (!Array.isArray(value)) throw new Error(`${path} must be an array`)
    value.forEach((item, index) => validateSchema(schema.items, item, `${path}[${index}]`))
  }
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${path} must be an object`)
    for (const key of schema.required ?? []) {
      if (!(key in value)) throw new Error(`${path}.${key} is required`)
    }
    for (const [key, item] of Object.entries(value)) {
      if (schema.properties[key]) validateSchema(schema.properties[key], item, `${path}.${key}`)
      else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
        validateSchema(schema.additionalProperties, item, `${path}.${key}`)
      } else if (!schema.additionalProperties) throw new Error(`${path}.${key} is unknown`)
    }
  }
}
