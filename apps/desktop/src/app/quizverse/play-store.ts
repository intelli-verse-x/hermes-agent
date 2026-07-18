import { atom } from 'nanostores'

import {
  bankPool,
  bundledFallback,
  dailyPool,
  dedupePlayQuestions,
  externalToPlayQuestions,
  inlineQuestions,
  isoWeekParts,
  normalizePlayQuestions,
  premiumPool,
  viralPool
} from './play-questions'

export interface PlaySession {
  deviceId: string
  userId: string
  username: string
}

export interface PlayQuestion {
  id: string
  prompt: string
  options: string[]
  correctIndex: number
  explanation?: string
  mediaAlt?: string
  mediaUrl?: string
}

export interface PlayResult {
  authority: 'server' | 'unranked'
  correct: number
  rank?: number
  ranked: boolean
  reason?: string
  rewards?: Record<string, unknown>
  score: number
  total: number
}

export interface PlayQuestionPack {
  fallbackReason?: string
  packId?: string
  provenance: 'ai' | 'bundled' | 'external' | 's3-bank' | 's3-daily' | 's3-premium' | 's3-viral' | 'weekly'
  questions: PlayQuestion[]
}

export interface PlaySubmissionState {
  error?: string
  idempotencyKey?: string
  phase: 'idle' | 'partial' | 'submitting' | 'submitted'
  result?: PlayResult
}

export const $playSession = atom<null | PlaySession>(null)
export const $playAuthState = atom<'connecting' | 'error' | 'guest' | 'idle'>('idle')
export const $playResult = atom<null | PlayResult>(null)
export const $playSubmission = atom<PlaySubmissionState>({ phase: 'idle' })

const rpcCache = new Map<string, Promise<unknown>>()
const submissions = new Map<string, { grading?: Record<string, unknown>; idempotencyKey: string; result?: PlayResult }>()
const RPC_TIMEOUT_MS = 8_000
const AI_RPC_TIMEOUT_MS = 20_000

function timeout<T>(promise: Promise<T>, milliseconds: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(`${label} timed out after ${milliseconds}ms`)), milliseconds)

    promise.then(resolve, reject).finally(() => window.clearTimeout(timer))
  })
}

export async function ensurePlaySession(): Promise<PlaySession> {
  const active = $playSession.get()

  if (active) {
    $playAuthState.set('guest')

    return active
  }

  $playAuthState.set('connecting')
  const bridge = window.hermesDesktop?.quizverse

  if (!bridge) {
    $playAuthState.set('error')
    throw new Error('QuizVerse secure session bridge is unavailable')
  }

  try {
    const session = await bridge.playSession()

    $playSession.set(session)
    $playAuthState.set('guest')

    return session
  } catch (error) {
    $playAuthState.set('error')
    throw error
  }
}

export async function playRpc<T>(
  name: string,
  payload: Record<string, unknown> = {},
  options: { cache?: boolean; timeoutMs?: number } = {}
): Promise<T> {
  await ensurePlaySession()
  const bridge = window.hermesDesktop?.quizverse

  if (!bridge) {
    throw new Error('QuizVerse secure RPC bridge is unavailable')
  }

  const key = `${name}:${JSON.stringify(payload)}`

  const request = options.cache && rpcCache.has(key)
    ? rpcCache.get(key)!
    : timeout(bridge.playRpc<T>(name, payload), options.timeoutMs ?? RPC_TIMEOUT_MS, name)

  if (options.cache && !rpcCache.has(key)) {
    rpcCache.set(key, request)
    void request.catch(() => rpcCache.delete(key))
  }

  return request as Promise<T>
}

function seenKey(modeId: string): string {
  return `quizverse_play_seen:${modeId}`
}

function readSeen(modeId: string): Set<string> {
  try {
    return new Set(JSON.parse(sessionStorage.getItem(seenKey(modeId)) ?? '[]') as string[])
  } catch {
    return new Set()
  }
}

function writeSeen(modeId: string, questions: PlayQuestion[]) {
  const seen = readSeen(modeId)

  questions.forEach(question => seen.add(question.id))
  sessionStorage.setItem(seenKey(modeId), JSON.stringify([...seen].slice(-500)))
}

async function weeklyPool(mode: PlayMode): Promise<PlayQuestion[]> {
  for (let weekBack = 0; weekBack < 3; weekBack += 1) {
    const probe = new Date()

    probe.setUTCDate(probe.getUTCDate() - weekBack * 7)
    const { isoWeek, isoYear } = isoWeekParts(probe)

    const candidates = await Promise.all(
      [7, 6, 5, 4, 3, 2, 1].map(isoDay =>
        playRpc<{ raw_json?: string }>(
          'quizverse_weekly_fetch',
          {
            iso_day: isoDay,
            iso_week: isoWeek,
            iso_year: isoYear,
            lang_code: 'en',
            type: mode.weeklyType ?? 'emoji'
          },
          { cache: true }
        ).catch(() => null)
      )
    )

    for (const candidate of candidates) {
      if (candidate?.raw_json) {
        try {
          const questions = normalizePlayQuestions(JSON.parse(candidate.raw_json))

          if (questions.length) {
            return questions
          }
        } catch {
          // Probe the next published slot.
        }
      }
    }
  }

  return []
}

export async function fetchPlayQuestions(mode: PlayMode, topic?: string): Promise<PlayQuestionPack> {
  let pool: PlayQuestion[] = []
  let provenance: PlayQuestionPack['provenance'] = 's3-bank'
  let fallbackReason: string | undefined

  if (mode.source === 'daily') {
    pool = await dailyPool()
    provenance = 's3-daily'
  } else if (mode.source === 'premium') {
    pool = await premiumPool()
    provenance = 's3-premium'
  } else if (mode.source === 'viral') {
    pool = await viralPool()
    provenance = 's3-viral'
  } else if (mode.source === 'weekly') {
    pool = await weeklyPool(mode)
    provenance = 'weekly'
  } else if (mode.source === 'external') {
    const rpcName = mode.provider === 'news' ? 'quizverse_fetch_news_quiz' : 'quizverse_fetch_external_quiz'

    const external = await playRpc<unknown>(rpcName, {
      provider: mode.provider,
      query: topic || mode.id
    }, { cache: true }).catch(error => {
      fallbackReason = error instanceof Error ? error.message : String(error)

      return null
    })

    pool = externalToPlayQuestions(mode.provider ?? '', external, mode.count)
    provenance = 'external'
  } else if (mode.source === 'ai') {
    const generated = await playRpc<unknown>('quizverse_ai_generate_questions', {
      count: mode.count,
      lang: 'en',
      topic: topic || mode.name
    }, { timeoutMs: AI_RPC_TIMEOUT_MS }).catch(error => {
      fallbackReason = error instanceof Error ? error.message : String(error)

      return null
    })

    pool = normalizePlayQuestions(generated)
    provenance = 'ai'
  }

  if (pool.length === 0) {
    pool = await bankPool()
    provenance = 's3-bank'
    fallbackReason ??= `No playable ${mode.source} content was available`
  }

  if (pool.length === 0) {
    pool = bundledFallback(mode.count)
    provenance = 'bundled'
    fallbackReason ??= 'Network question sources were unavailable'
  }

  const request: {
    error?: string
    fallback_to_client?: boolean
    message?: string
    ok?: boolean
    question_pack_id?: string
    questions?: unknown[]
  } = await playRpc<{
    error?: string
    fallback_to_client?: boolean
    message?: string
    ok?: boolean
    question_pack_id?: string
    questions?: unknown[]
  }>(
    'quizverse_get_questions',
    {
      count: mode.count,
      id_prefix: mode.source,
      inline_questions: inlineQuestions(pool),
      kind: mode.source === 'daily' || mode.source === 'premium' ? 'daily' : 'deduped_s3',
      mode: mode.enumName,
      scope: 'global',
      topic: topic || mode.id
    }
  ).catch(error => {
    fallbackReason ??= error instanceof Error ? error.message : String(error)

    return { fallback_to_client: true }
  })

  if (request.ok === false) {
    fallbackReason = request.message ?? request.error ?? fallbackReason ?? 'The authoritative question service is unavailable'
  }

  const served = normalizePlayQuestions(request.questions ?? [])

  const questions = served.length
    ? served.slice(0, mode.count)
    : dedupePlayQuestions(pool, readSeen(mode.id)).slice(0, mode.count)

  writeSeen(mode.id, questions)

  return {
    fallbackReason,
    packId: request.question_pack_id,
    provenance,
    questions
  }
}

export async function submitPlayResult(
  mode: PlayMode,
  questions: PlayQuestion[],
  answers: (number | null)[],
  packId: string | undefined,
  durationMs: number,
  latencies: number[]
) {
  const fingerprint = `${packId ?? mode.id}:${answers.join(',')}:${questions.map(question => question.id).join(',')}`
  const existing = submissions.get(fingerprint)

  if (existing?.result) {
    $playResult.set(existing.result)
    $playSubmission.set({ idempotencyKey: existing.idempotencyKey, phase: 'submitted', result: existing.result })

    return existing.result
  }

  if ($playSubmission.get().phase === 'submitting') {
    throw new Error('This result is already being submitted')
  }

  const idempotencyKey = existing?.idempotencyKey ?? crypto.randomUUID()
  const clientCorrect = answers.filter((answer, index) => answer === questions[index]?.correctIndex).length

  const clientResult: PlayResult = {
    authority: 'unranked',
    correct: clientCorrect,
    ranked: false,
    reason: 'The server did not issue a verified question pack. This local result cannot affect rankings or rewards.',
    score: clientCorrect * 100,
    total: questions.length
  }

  let grading = existing?.grading

  submissions.set(fingerprint, { grading, idempotencyKey })
  $playSubmission.set({ idempotencyKey, phase: 'submitting' })

  if (!packId) {
    submissions.set(fingerprint, { idempotencyKey, result: clientResult })
    $playResult.set(clientResult)
    $playSubmission.set({ idempotencyKey, phase: 'submitted', result: clientResult })

    return clientResult
  }

  try {
    if (!grading) {
      grading = await playRpc<Record<string, unknown>>('quiz_submit_result_v2', {
        answers: answers.map((selectedIndex, index) => ({
          latency_ms: Math.max(0, Math.round(latencies[index] ?? 0)),
          question_id: questions[index]?.id,
          selected_index: selectedIndex ?? -1
        })),
        duration_ms: Math.max(0, Math.round(durationMs)),
        idempotency_key: idempotencyKey,
        mode: mode.enumName,
        question_pack_id: packId
      })
      submissions.set(fingerprint, { grading, idempotencyKey })
    }
  } catch (error) {
    submissions.delete(fingerprint)
    $playSubmission.set({ error: error instanceof Error ? error.message : String(error), idempotencyKey, phase: 'idle' })
    throw error
  }

  const session = await ensurePlaySession()
  const authoritative = (grading?.data ?? grading ?? {}) as Record<string, unknown>
  const authoritativeCorrect = authoritative.correct ?? authoritative.correct_count
  const authoritativeScore = authoritative.score ?? authoritative.total_score

  if (!Number.isFinite(Number(authoritativeCorrect)) || !Number.isFinite(Number(authoritativeScore))) {
    submissions.delete(fingerprint)
    $playSubmission.set({
      error: 'Server grading returned no authoritative score',
      idempotencyKey,
      phase: 'idle'
    })
    throw new Error('Server grading returned no authoritative score; the result was not ranked or rewarded')
  }

  const result = {
    authority: 'server' as const,
    correct: Number(authoritativeCorrect),
    rank: authoritative.rank == null ? undefined : Number(authoritative.rank),
    ranked: true,
    rewards: (authoritative.rewards ?? authoritative.reward) as Record<string, unknown> | undefined,
    score: Number(authoritativeScore),
    total: Number(authoritative.total ?? authoritative.question_count ?? clientResult.total)
  }

  try {
    const sync = await playRpc<Record<string, unknown>>('submit_score_and_sync', {
      correct: result.correct,
      device_id: session.deviceId,
      game_id: 'quizverse',
      idempotency_key: idempotencyKey,
      leaderboard_id: 'quizverse_global',
      mode: mode.enumName,
      score: result.score,
      total: result.total
    })

    const syncData = (sync.data ?? sync) as Record<string, unknown>

    if (syncData.rank != null) {
      result.rank = Number(syncData.rank)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)

    $playSubmission.set({ error: message, idempotencyKey, phase: 'partial', result })
    throw new Error(`Score was graded but leaderboard sync failed: ${message}`)
  }

  submissions.set(fingerprint, { grading, idempotencyKey, result })
  $playResult.set(result)
  $playSubmission.set({ idempotencyKey, phase: 'submitted', result })

  return result
}

export interface PlayMode {
  id: string
  enumName: string
  name: string
  icon: string
  category: string
  count: number
  source: 'ai' | 'bank' | 'daily' | 'external' | 'premium' | 'viral' | 'weekly'
  available: boolean
  provider?: string
  protocol?: 'ai-chat' | 'live' | 'native-surface' | 'party' | 'phantom' | 'sync-beat' | 'tournament'
  reason?: string
  weeklyType?: string
}

const rpc = (id: string, enumName: string, name: string, icon: string, category = 'knowledge'): PlayMode => ({
  available: true, category, count: 10, enumName, icon, id, name, source: 'bank'
})

const ai = (id: string, enumName: string, name: string, icon: string): PlayMode => ({
  ...rpc(id, enumName, name, icon, 'ai'), source: 'ai'
})

const unavailable = (id: string, enumName: string, name: string, icon: string, reason: string): PlayMode => ({
  available: false, category: 'special', count: 0, enumName, icon, id, name, reason, source: 'bank'
})

const protocol = (
  id: string,
  enumName: string,
  name: string,
  icon: string,
  protocolName: NonNullable<PlayMode['protocol']>
): PlayMode => ({
  available: true,
  category: 'social',
  count: 10,
  enumName,
  icon,
  id,
  name,
  protocol: protocolName,
  source: 'bank'
})

export const PLAY_MODES: readonly PlayMode[] = [
  rpc('solo', 'SoloChallenge', 'Solo Challenge', '🎯', 'speed'),
  rpc('local-battle', 'LocalBattle', 'Local Battle', '🎮', 'social'),
  { ...protocol('link-and-play', 'LinkAndPlay', 'Link & Play', '🔗', 'native-surface'), category: 'ai', count: 0 },
  ai('pick-topic', 'PickATopic', 'Pick a Topic', '📚'),
  { ...rpc('daily', 'DailyQuiz', 'Daily Quiz', '📅', 'premium'), source: 'daily' },
  { ...rpc('daily-premium', 'DailyPremiumQuiz', 'Daily Premium', '👑', 'premium'), source: 'premium' },
  { ...rpc('weekly', 'WeeklyQuiz', 'Weekly Quiz', '🗓️', 'premium'), source: 'weekly', weeklyType: 'emoji' },
  rpc('mcq', 'MultipleChoiceQuiz', 'Multiple Choice', '🔤'),
  rpc('true-false', 'TrueFalseQuiz', 'True & False', '✅'),
  rpc('speed', 'SpeedQuiz', 'Speed Quiz', '⏱️', 'speed'),
  rpc('brain-sprint', 'BrainSprint', 'Brain Sprint', '🧠', 'speed'),
  rpc('survival', 'SurvivalQuiz', 'Survival Quiz', '❤️', 'speed'),
  { ...rpc('viral-iq', 'ViralIQ', 'Viral IQ', '🔥', 'speed'), source: 'viral' },
  rpc('geo', 'GeoExplore', 'Geo Explore', '🌍', 'special'),
  rpc('whos-that', 'WhosThat', "Who's That", '🕵️', 'special'),
  { ...rpc('health', 'HealthQuiz', 'Health Quiz', '🩺', 'special'), source: 'weekly', weeklyType: 'health' },
  { ...rpc('personal-finance', 'PersonalFinanceQuiz', 'Personal Finance', '💰', 'special'), source: 'weekly', weeklyType: 'personal_finance' },
  { ...rpc('emoji', 'EmojiQuiz', 'Emoji Quiz', '😀', 'creative'), source: 'weekly', weeklyType: 'emoji' },
  { ...rpc('fortune', 'FortuneQuiz', 'Fortune Quiz', '🔮', 'special'), source: 'weekly', weeklyType: 'fortune' },
  { ...rpc('prediction', 'PredictionQuiz', 'Prediction Quiz', '🎲', 'special'), source: 'weekly', weeklyType: 'prediction' },
  rpc('connection', 'ConnectionMode', 'Connection Mode', '🔗', 'creative'),
  rpc('image', 'ImageQuiz', 'Image Quiz', '🖼️', 'media'),
  rpc('audio', 'AudioQuiz', 'Audio Quiz', '🔊', 'media'),
  rpc('video', 'VideoQuiz', 'Video Quiz', '🎬', 'media'),
  { ...rpc('guess-anime', 'GuessAnime', 'Guess Anime', '🌸', 'media'), provider: 'jikan', source: 'external' },
  { ...rpc('guess-dog', 'GuessDog', 'Guess the Dog', '🐶', 'media'), provider: 'dog', source: 'external' },
  { ...rpc('guess-dish', 'GuessDish', 'Guess the Dish', '🍜', 'media'), provider: 'themealdb', source: 'external' },
  { ...rpc('guess-pokemon', 'GuessPokemon', 'Guess Pokémon', '⚡', 'creative'), provider: 'pokeapi', source: 'external' },
  { ...rpc('sports', 'SportsQuiz', 'Sports Quiz', '🏅', 'speed'), provider: 'sports', source: 'external' },
  { ...rpc('space', 'SpaceTrivia', 'Space Trivia', '🚀', 'special'), provider: 'nasa', source: 'external' },
  { ...rpc('star-wars', 'StarWarsQuiz', 'Star Wars Quiz', '🌌', 'special'), provider: 'starwars', source: 'external' },
  { ...rpc('disney', 'DisneyQuiz', 'Disney Quiz', '🏰', 'creative'), provider: 'disney', source: 'external' },
  { ...rpc('guess-flag', 'GuessTheFlag', 'Guess the Flag', '🚩', 'special'), provider: 'countries', source: 'external' },
  { ...rpc('guess-ghibli', 'GuessGhibli', 'Guess Ghibli', '🎐', 'media'), provider: 'ghibli', source: 'external' },
  { ...rpc('news', 'NewsQuiz', 'News Quiz', '📰', 'media'), provider: 'news', source: 'external' },
  ai('ai-mode', 'AIMode', 'AI Quiz', '🤖'),
  ai('custom-topic', 'CustomTopic', 'Custom Topic', '✏️'),
  ai('ai-host', 'AIHost', 'AutoCurio Reading', '🎙️'),
  ai('ai-fortune', 'AIFortuneTeller', 'Sage Reading', '🧙'),
  { ...protocol('ai-chat', 'AIChat', 'AI Chat', '💬', 'ai-chat'), category: 'ai', count: 0 },
  { ...protocol('sync-beat', 'SyncWithBeat', 'Sync with Beat', '🎵', 'sync-beat'), category: 'creative', count: 20 },
  protocol('live-arena', 'LiveArena', 'Live Arena', '⚡', 'live'),
  protocol('phantom-arena', 'PhantomArena', 'Phantom Arena', '👻', 'phantom'),
  protocol('party', 'PartyAndTrivia', 'Party & Trivia', '🎉', 'party'),
  protocol('tournament', 'Tournament', 'Tournament', '🏆', 'tournament'),
  unavailable('subjective', 'SubjectiveQuiz', 'Subjective Quiz', '📝', 'No server-side judging protocol is published.'),
  unavailable('rhythm', 'RhythmQuiz', 'Rhythm Quiz', '🥁', 'Requires the Unity rhythm asset pack.'),
  unavailable('ar-vr', 'ARVR', 'AR / VR', '🥽', 'Requires native XR hardware support.')
  ,
  unavailable('ai-tutor', 'AITutor', 'Tinckers Session', '🧑‍🏫', 'The reference mode is not implemented and publishes no game protocol.'),
  unavailable('iq-rush', 'IQRush', 'IQ Rush', '🏷️', 'The reference mode is not implemented and has no logo asset feed.'),
  unavailable('hot', 'HotQuiz', 'Hot Quiz', '🌶️', 'The reference mode is not implemented and has no trending feed contract.'),
  unavailable('ai-gen', 'AIGen', 'AI Gen', '✨', 'The reference mode is not implemented; use AI Quiz instead.'),
  unavailable('adaptive', 'AdaptiveDifficulty', 'Adaptive Difficulty', '📈', 'The reference mode is not implemented and publishes no adaptation protocol.'),
  unavailable('personality', 'PersonalityRec', 'Personality Rec', '🎭', 'The reference mode is not implemented and publishes no recommendation protocol.'),
  unavailable('tiktok', 'TikTokQuizzes', 'TikTok Quizzes', '📱', 'The reference mode is not implemented and publishes no licensed feed.'),
  unavailable('proc-story', 'ProcStoryline', 'Proc Storyline', '📖', 'The reference mode is not implemented and publishes no storyline engine.'),
  unavailable('word-assoc', 'WordAssoc', 'Word Assoc', '🔡', 'The reference mode is not implemented and publishes no scoring contract.'),
  unavailable('context-clues', 'ContextClues', 'Context Clues', '🔍', 'The reference mode is not implemented and publishes no scoring contract.'),
  unavailable('creative-eval', 'CreativeEval', 'Creative Eval', '🎨', 'The reference mode is not implemented and publishes no judging contract.')
  ,
  unavailable('video-analysis', 'VideoAnalysis', 'Video Analysis', '🎞️', 'The reference mode is not implemented and publishes no video-analysis protocol.'),
  unavailable('fill-blanks', 'FillBlanks', 'Fill Blanks', '⬜', 'The reference mode is not implemented and publishes no fill-in scoring contract.')
]
