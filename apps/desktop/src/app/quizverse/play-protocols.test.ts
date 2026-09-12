import { describe, expect, it } from 'vitest'

import {
  createSyncBeatTimeline,
  decodeLiveProtocolFrame,
  firstSupportedPartyRpc,
  liveAnswerPayload,
  OP_TURN_INPUT_SUBMIT,
  OP_TURN_START,
  PARTY_CREATE_RPCS,
  PARTY_JOIN_RPCS,
  scoreSyncBeat
} from './play-protocols'

describe('native Play protocols', () => {
  it('decodes sync-turn-v1 turns and builds measured answer frames', () => {
    const event = decodeLiveProtocolFrame({
      data: JSON.stringify({ p: { turn_payload: { options: ['A', 'B'], question_id: 'q1', text: 'Question?' } } }),
      opCode: OP_TURN_START
    })

    expect(event).toEqual(expect.objectContaining({ type: 'turn' }))
    expect(event.payload.turn_payload).toEqual(expect.objectContaining({ question_id: 'q1' }))
    expect(OP_TURN_INPUT_SUBMIT).toBe(0x4010)
    expect(liveAnswerPayload('q1', 1, 123.6)).toEqual({
      p: { client_response_ms: 124, option_index: 1, question_id: 'q1' }
    })
  })

  it('ignores malformed or unknown realtime frames', () => {
    expect(decodeLiveProtocolFrame({ data: '{', opCode: OP_TURN_START }).type).toBe('ignored')
    expect(decodeLiveProtocolFrame({ data: '{}', opCode: 999 }).type).toBe('ignored')
  })

  it('uses deployed and compatibility Party matchmaking RPC names', () => {
    expect(PARTY_CREATE_RPCS).toEqual(['matchmaking_create_party', 'party_create'])
    expect(PARTY_JOIN_RPCS).toEqual(['matchmaking_join_party', 'party_join'])
  })

  it('falls back when a Party RPC returns a resolved rejection', async () => {
    const calls: string[] = []

    const result = await firstSupportedPartyRpc(PARTY_CREATE_RPCS, { game_id: 'quizverse' }, async name => {
      calls.push(name)

      return name === 'matchmaking_create_party'
        ? { error: 'unsupported', success: false }
        : { code: 'ABCD', success: true }
    })

    expect(calls).toEqual(['matchmaking_create_party', 'party_create'])
    expect(result).toEqual({ name: 'party_create', result: { code: 'ABCD', success: true } })
  })

  it('generates deterministic Sync Beat timing and scores one tap per beat', () => {
    const first = createSyncBeatTimeline(42, 4, 120)
    const second = createSyncBeatTimeline(42, 4, 120)

    expect(first).toEqual(second)
    expect(first.map(beat => beat.atMs)).toEqual([...first.map(beat => beat.atMs)].sort((a, b) => a - b))
    expect(scoreSyncBeat(first, [first[0].atMs + 30, first[0].atMs + 35, first[1].atMs - 10])).toEqual({
      accuracy: 0.5,
      averageOffsetMs: 20,
      hits: 2,
      total: 4
    })
  })
})
