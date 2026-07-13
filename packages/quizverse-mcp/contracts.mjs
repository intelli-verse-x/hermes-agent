import { QUIZVERSE_RESPONSE_CONTRACTS } from './response-contracts.mjs'
import { QUIZ_FETCH_ROUTES } from './quiz-fetch-contracts.mjs'

// Shared, data-only contract manifest. Electron owns enforcement; the MCP
// server independently checks every mapped RPC against this same immutable
// inventory before crossing the authenticated broker boundary.
const REQUEST_CONTRACTS = {
  qv_profile_get: read('player_get_full_profile'),
  qv_stats_get: read('get_player_stats'),
  qv_context_get: read('quizverse_get_player_context'),
  qv_quiz_fetch: Object.freeze({
    allowedKeys: ['kind', 'mode', 'scope', 'topic', 'count', 'id_prefix', 'inline_questions', 'type', 'lang_code', 'iso_year', 'iso_week', 'iso_day', 'provider', 'country', 'lang'],
    authenticated: false,
    required: [],
    routes: QUIZ_FETCH_ROUTES,
    rpcs: Object.values(QUIZ_FETCH_ROUTES).map(route => route.rpc),
    write: false
  }),
  qv_quiz_history: read('quiz_get_history', ['limit', 'cursor']),
  qv_quiz_stats: read('quiz_get_stats'),
  qv_leaderboard_get: read('get_leaderboard', ['game_id', 'scope', 'limit'], ['game_id', 'scope']),
  qv_wallet_get: read('wallet_get_balances', ['gameId'], ['gameId'], true),
  qv_entitlements_get: read('quizverse_get_entitlements', [], [], true),
  qv_friends_list: read('friends_list', ['limit', 'cursor', 'state'], [], true),
  qv_tournaments_list: read('tournament_list', ['limit', 'cursor']),
  qv_async_status: read('async_challenge_get', ['sessionId', 'shareCode']),
  qv_knowledge_map: read('quizverse_knowledge_map', ['game_id'], ['game_id']),
  qv_tutorx_progress: tutor(/^\/api\/v1\/learning\/progress$/),
  qv_tutorx_sessions: tutor(/^\/api\/v1\/sessions\?limit=\d+&offset=\d+$/),
  qv_quiz_submit: write('quiz_submit_result_v2', ['question_pack_id', 'mode', 'duration_ms', 'answers', 'idempotency_key'], ['question_pack_id', 'mode', 'duration_ms', 'answers', 'idempotency_key']),
  qv_quiz_sync_score: write('submit_score_and_sync', ['leaderboard_id', 'game_id', 'device_id', 'mode', 'score', 'correct', 'total', 'idempotency_key'], ['leaderboard_id', 'game_id', 'device_id', 'mode', 'score', 'correct', 'total', 'idempotency_key']),
  qv_friend_invite: write('send_friend_invite', ['targetUserId', 'message'], ['targetUserId'], true),
  qv_friend_challenge: write('send_friend_challenge', ['friendUserId', 'gameId', 'challengeData', 'correlationId'], ['friendUserId', 'gameId', 'challengeData'], true),
  qv_async_create: write('async_challenge_create', ['quizModeType', 'quizModeName', 'quizConfig', 'challengedUserId', 'challengedDisplayName', 'playerDisplayName', 'idempotency_key'], ['quizModeType', 'quizModeName', 'idempotency_key']),
  qv_async_join: write('async_challenge_join', ['shareCode', 'playerDisplayName'], ['shareCode']),
  qv_async_submit: write('async_challenge_submit', ['sessionId', 'score', 'correctAnswers', 'totalQuestions', 'timeTaken', 'accuracy', 'categoryName', 'categoryId', 'questionHistory', 'idempotency_key'], ['sessionId', 'score', 'correctAnswers', 'totalQuestions', 'timeTaken', 'idempotency_key']),
  qv_tournament_enter: write('tournament_enter', ['slug', 'paid_via', 'idempotency_key'], ['slug', 'paid_via', 'idempotency_key'], true, true),
  qv_reward_claim: write('quizverse_claim_daily_reward', ['gameID'], ['gameID'], true, true),
  qv_party_create: write('matchmaking_create_party', ['gameId', 'maxSize'], ['gameId', 'maxSize'], true),
  qv_party_join: write('matchmaking_join_party', ['gameId', 'partyId'], ['gameId', 'partyId'], true),
  qv_party_status: read('matchmaking_get_status', ['gameId', 'ticketId'], ['gameId', 'ticketId'], true)
}

export const QUIZVERSE_CONTRACTS = Object.freeze(Object.fromEntries(
  Object.entries(REQUEST_CONTRACTS).map(([name, request]) => [
    name,
    Object.freeze({ ...request, response: QUIZVERSE_RESPONSE_CONTRACTS[name] })
  ])
))

function read(rpc, allowedKeys = [], required = [], authenticated = false) {
  return Object.freeze({ allowedKeys, authenticated, required, rpc, write: false })
}

function tutor(tutorPath) {
  return Object.freeze({ allowedKeys: [], authenticated: false, required: [], tutorPath, write: false })
}

function write(rpc, allowedKeys, required, authenticated = false, hard = false) {
  return Object.freeze({ allowedKeys, authenticated, hard, required, rpc, write: true })
}
