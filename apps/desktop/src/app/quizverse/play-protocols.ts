export const LIVE_MATCH_QUERY = '+label.game_id:quizverse +label.template_id:sync-turn-v1'
export const OP_MATCH_ENDED = 0x0007
export const OP_TURN_START = 0x4001
export const OP_TURN_RESOLVED = 0x4004
export const OP_SCORE_UPDATE = 0x4005
export const OP_TURN_INPUT_SUBMIT = 0x4010

export const PARTY_CREATE_RPCS = ['matchmaking_create_party', 'party_create'] as const
export const PARTY_JOIN_RPCS = ['matchmaking_join_party', 'party_join'] as const

export interface LiveProtocolEvent {
  payload: Record<string, unknown>
  type: 'ended' | 'ignored' | 'score' | 'turn' | 'turn-resolved'
}

export interface SyncBeat {
  atMs: number
  id: string
}

export async function firstSupportedPartyRpc(
  names: readonly string[],
  payload: Record<string, unknown>,
  rpc: (name: string, payload: Record<string, unknown>) => Promise<Record<string, unknown>>
): Promise<{ name: string; result: Record<string, unknown> }> {
  let lastError: unknown

  for (const name of names) {
    try {
      const result = await rpc(name, payload)

      if (result.success === false) {
        throw new Error(String(result.error ?? `${name} rejected the request`))
      }

      return { name, result }
    } catch (error) {
      lastError = error
    }
  }

  throw lastError ?? new Error('No compatible QuizVerse Party endpoint is available')
}

export function decodeLiveProtocolFrame(frame: { data?: unknown; opCode?: unknown }): LiveProtocolEvent {
  let envelope: Record<string, unknown> = {}

  try {
    envelope =
      typeof frame.data === 'string'
        ? (JSON.parse(frame.data) as Record<string, unknown>)
        : ((frame.data ?? {}) as Record<string, unknown>)
  } catch {
    return { payload: {}, type: 'ignored' }
  }

  const payload = (envelope.p ?? envelope) as Record<string, unknown>

  switch (Number(frame.opCode)) {
    case OP_MATCH_ENDED:
      return { payload, type: 'ended' }

    case OP_SCORE_UPDATE:
      return { payload, type: 'score' }

    case OP_TURN_RESOLVED:
      return { payload, type: 'turn-resolved' }

    case OP_TURN_START:
      return { payload, type: 'turn' }

    default:
      return { payload, type: 'ignored' }
  }
}

export function liveAnswerPayload(questionId: string, optionIndex: number, responseMs: number) {
  return {
    p: {
      client_response_ms: Math.max(0, Math.round(responseMs)),
      option_index: optionIndex,
      question_id: questionId
    }
  }
}

export function createSyncBeatTimeline(seed: number, count = 20, bpm = 100): SyncBeat[] {
  const interval = 60_000 / Math.max(40, Math.min(220, bpm))
  let state = seed >>> 0

  return Array.from({ length: count }, (_, index) => {
    state = (Math.imul(state ^ (state >>> 15), 1 | state) + 0x6d2b79f5) >>> 0
    const swing = ((state % 121) - 60) / 100

    return {
      atMs: Math.max(0, Math.round(900 + index * interval + swing * interval * 0.12)),
      id: `beat-${index + 1}`
    }
  })
}

export function scoreSyncBeat(timeline: SyncBeat[], taps: number[], toleranceMs = 180) {
  const available = new Set(timeline.map((_, index) => index))
  const matches: number[] = []

  for (const tap of taps) {
    let best = -1
    let distance = Number.POSITIVE_INFINITY

    for (const index of available) {
      const candidate = Math.abs(timeline[index].atMs - tap)

      if (candidate < distance) {
        distance = candidate
        best = index
      }
    }

    if (best >= 0 && distance <= toleranceMs) {
      available.delete(best)
      matches.push(distance)
    }
  }

  return {
    accuracy: timeline.length ? matches.length / timeline.length : 0,
    averageOffsetMs: matches.length ? matches.reduce((sum, value) => sum + value, 0) / matches.length : 0,
    hits: matches.length,
    total: timeline.length
  }
}
