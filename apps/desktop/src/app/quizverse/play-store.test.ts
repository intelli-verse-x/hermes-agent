// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { externalToPlayQuestions, isoWeekParts } from './play-questions'
import {
  $playSession,
  $playSubmission,
  fetchPlayQuestions,
  type PlayMode,
  submitPlayResult
} from './play-store'

const mode: PlayMode = {
  available: true,
  category: 'test',
  count: 2,
  enumName: 'MultipleChoiceQuiz',
  icon: 'T',
  id: 'test-mode',
  name: 'Test',
  source: 'bank'
}

function installBridge(playRpc: ReturnType<typeof vi.fn>) {
  Object.defineProperty(window, 'hermesDesktop', {
    configurable: true,
    value: {
      quizverse: {
        playRpc,
        playSession: vi.fn(async () => ({ deviceId: 'device-1', userId: 'user-1', username: 'Guest' }))
      }
    }
  })
}

describe('native Play contracts', () => {
  beforeEach(() => {
    sessionStorage.clear()
    $playSession.set(null)
    $playSubmission.set({ phase: 'idle' })
  })

  it('uses server grading and one idempotency key for grading and sync', async () => {
    const rpc = vi.fn(async (name: string, _payload?: Record<string, unknown>) => {
      if (name === 'quiz_submit_result_v2') {
        return { correct: 1, score: 875, total: 2 }
      }

      return { data: { rank: 7 }, success: true }
    })

    installBridge(rpc)

    const result = await submitPlayResult(
      mode,
      [
        { correctIndex: 0, id: 'q1', options: ['A', 'B'], prompt: 'One?' },
        { correctIndex: 1, id: 'q2', options: ['A', 'B'], prompt: 'Two?' }
      ],
      [0, 0],
      'pack-1',
      4_500,
      [800, 1_200]
    )

    const gradePayload = rpc.mock.calls.find(call => call[0] === 'quiz_submit_result_v2')?.[1]
    const syncPayload = rpc.mock.calls.find(call => call[0] === 'submit_score_and_sync')?.[1]

    expect(result).toEqual(expect.objectContaining({ correct: 1, rank: 7, score: 875, total: 2 }))
    expect(gradePayload?.idempotency_key).toBe(syncPayload?.idempotency_key)
    expect(gradePayload?.answers).toEqual([
      expect.objectContaining({ latency_ms: 800 }),
      expect.objectContaining({ latency_ms: 1_200 })
    ])
  })

  it('retries only sync after a partial submission', async () => {
    let syncAttempts = 0

    const rpc = vi.fn(async (name: string, _payload?: Record<string, unknown>) => {
      if (name === 'quiz_submit_result_v2') {
        return { correct: 1, score: 500, total: 1 }
      }

      if (name === 'submit_score_and_sync' && syncAttempts++ === 0) {
        throw new Error('temporary sync failure')
      }

      return { success: true }
    })

    installBridge(rpc)
    const question = [{ correctIndex: 0, id: 'retry-q', options: ['A', 'B'], prompt: 'Retry?' }]

    await expect(submitPlayResult(mode, question, [0], 'retry-pack', 1000, [900])).rejects.toThrow(
      'graded but leaderboard sync failed'
    )
    expect($playSubmission.get().phase).toBe('partial')
    await submitPlayResult(mode, question, [0], 'retry-pack', 1000, [900])
    expect(rpc.mock.calls.filter(call => call[0] === 'quiz_submit_result_v2')).toHaveLength(1)
    expect(rpc.mock.calls.filter(call => call[0] === 'submit_score_and_sync')).toHaveLength(2)
  })

  it('keeps client fallback results unranked and never syncs them', async () => {
    const rpc = vi.fn(async () => ({ success: true }))

    installBridge(rpc)

    const result = await submitPlayResult(
      { ...mode, id: 'fallback-mode' },
      [{ correctIndex: 0, id: 'fallback-q', options: ['A', 'B'], prompt: 'Fallback?' }],
      [0],
      undefined,
      720,
      [650]
    )

    expect(result).toEqual(expect.objectContaining({
      authority: 'unranked',
      correct: 1,
      ranked: false,
      score: 100
    }))
    expect(rpc).not.toHaveBeenCalled()
    expect($playSubmission.get()).toEqual(expect.objectContaining({ phase: 'submitted', result }))
  })

  it('rejects incomplete grading instead of trusting the client score', async () => {
    const rpc = vi.fn(async (name: string) =>
      name === 'quiz_submit_result_v2' ? { success: true } : { rank: 1 }
    )

    installBridge(rpc)
    await expect(submitPlayResult(
      { ...mode, id: 'invalid-grade-mode' },
      [{ correctIndex: 0, id: 'invalid-grade-q', options: ['A', 'B'], prompt: 'Grade?' }],
      [0],
      'invalid-grade-pack',
      900,
      [850]
    )).rejects.toThrow('no authoritative score')
    expect(rpc.mock.calls.map(call => call[0])).toEqual(['quiz_submit_result_v2'])
  })

  it('client-deduplicates fallback questions and records provenance', async () => {
    const rpc = vi.fn(async () => ({
      error: 'cache_empty',
      message: 'Questions are warming in the background. Please retry shortly.',
      ok: false
    }))

    installBridge(rpc)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          questions: [
            { correct_answer: 0, id: 'seen', options: ['A', 'B'], question: 'Seen?' },
            { correct_answer: 1, id: 'new', options: ['A', 'B'], question: 'New?' }
          ]
        })
      )
    )
    sessionStorage.setItem('quizverse_play_seen:test-mode', JSON.stringify(['seen']))
    const result = await fetchPlayQuestions(mode)

    expect(result.provenance).toBe('s3-bank')
    expect(result.questions.map(question => question.id)).toEqual(['new'])
    expect(result.fallbackReason).toBe('Questions are warming in the background. Please retry shortly.')
    expect(rpc).toHaveBeenCalledWith('quizverse_get_questions', expect.any(Object))
    vi.unstubAllGlobals()
  })

  it('adapts provider cards and calculates ISO week years', () => {
    const questions = externalToPlayQuestions(
      'pokeapi',
      {
        results: [
          { name: 'bulbasaur', url: 'https://pokeapi.co/api/v2/pokemon/1/' },
          { name: 'ivysaur', url: 'https://pokeapi.co/api/v2/pokemon/2/' },
          { name: 'venusaur', url: 'https://pokeapi.co/api/v2/pokemon/3/' },
          { name: 'charmander', url: 'https://pokeapi.co/api/v2/pokemon/4/' }
        ]
      },
      1
    )

    expect(questions).toHaveLength(1)
    expect(questions[0].options).toHaveLength(4)
    expect(isoWeekParts(new Date('2021-01-01T12:00:00Z'))).toEqual({ isoDay: 5, isoWeek: 53, isoYear: 2020 })
  })
})
