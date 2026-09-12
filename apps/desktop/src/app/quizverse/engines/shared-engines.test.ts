import { describe, expect, it, vi } from 'vitest'

import { fallbackWordsDaily } from './authoritative-content'
import { entitlementDecision, hasActiveEntitlement } from './entitlements'
import { normalizeLeaderboard } from './leaderboard'
import {
  buildWordSearch,
  CROSSWORD_PUZZLES,
  crosswordCleanSolveEligible,
  imposterIndices,
  imposterResult,
  isPangram,
  scoreWord,
  SPELL_PUZZLES,
  spellScore,
  validateSpellWord,
  VOYAGE_THEMES,
  voyageSeed,
  voyageTheme,
  WORD_GROUP_PUZZLES,
  wordShareGrid
} from './native-game-content'
import { createQuizRunner } from './quiz-runner'
import { createRealtimeChannel } from './realtime'
import { reusableVoyageCheckoutAttempt } from './voyage-checkout'

describe('native shared engines', () => {
  it('matches the source Words FNV seed and epoch day', () => {
    const content = fallbackWordsDaily('daily', 'general', new Date('2026-05-25T12:00:00Z'))
    expect(content.day_index).toBe(0)
    expect(content.seed).toBe(1_970_349_510)
    expect(content.utc_day).toBe('2026-05-25')
    expect(content.server_decided).toBe(false)
  })

  it('runs a quiz once and rejects out-of-range answers', () => {
    const runner = createQuizRunner([
      { correctIndex: 1, id: 'q1', options: ['A', 'B'], prompt: 'Pick B' },
      { correctIndex: 0, id: 'q2', options: ['A', 'B'], prompt: 'Pick A' }
    ])

    runner.start()
    expect(runner.answer(1).score).toBe(1)
    expect(() => runner.answer(3)).toThrow(/outside/)
    expect(runner.answer(0)).toMatchObject({ phase: 'complete', score: 2 })
    expect(runner.answer(0).answers).toHaveLength(2)
  })

  it('normalizes leaderboard aliases and entitlement policy', () => {
    expect(
      normalizeLeaderboard({
        records: [{ owner_id: 'u1', playerName: 'Ada', rank: 1, score: 42 }]
      })
    ).toEqual([{ ownerId: 'u1', rank: 1, score: 42, username: 'Ada' }])
    expect(entitlementDecision({ premium: false, requiresPremium: true }).reason).toBe('premium-required')
    expect(entitlementDecision({ cooldownUntil: 200, now: 100, premium: true })).toMatchObject({
      allowed: false,
      reason: 'cooldown',
      retryAt: 200
    })
    expect(
      hasActiveEntitlement(
        {
          data: { entitlements: [{ product_id: 'voyage_pass', status: 'active' }] }
        },
        'qv_voyage_pass'
      )
    ).toBe(true)
    expect(hasActiveEntitlement({ entitlements: ['qv_voyage_pass'] }, 'qv_voyage_pass')).toBe(true)
    expect(hasActiveEntitlement({ active: { qv_voyage_pass: true } }, 'qv_voyage_pass')).toBe(true)
    expect(
      hasActiveEntitlement(
        {
          data: {
            consumables: {},
            one_time: {},
            subscriptions: {
              qv_voyage_pass: { active: true, expires_at: '2099-01-01T00:00:00Z' }
            }
          }
        },
        'qv_voyage_pass'
      )
    ).toBe(true)
    expect(
      hasActiveEntitlement(
        {
          data: {
            subscriptions: {
              qv_voyage_pass: { active: false, expires_at: '2099-01-01T00:00:00Z' }
            }
          }
        },
        'qv_voyage_pass'
      )
    ).toBe(false)
    expect(
      hasActiveEntitlement(
        {
          entitlements: [{ active: true, expires_at: '2020-01-01T00:00:00Z', product_id: 'voyage_pass' }]
        },
        'qv_voyage_pass'
      )
    ).toBe(false)
  })

  it('keeps an ordinarily cancelled Voyage pass active only until expiration', () => {
    const now = Date.parse('2040-01-15T12:00:00Z')

    const entitlement = (status: string, expiresAt = '2040-02-01T00:00:00Z', active?: boolean) => ({
      entitlements: [{ active, expires_at: expiresAt, product_id: 'voyage_pass', status }]
    })

    expect(hasActiveEntitlement(entitlement('cancelled'), 'qv_voyage_pass', now)).toBe(true)
    expect(hasActiveEntitlement(entitlement('cancelled', '2040-01-01T00:00:00Z'), 'qv_voyage_pass', now)).toBe(false)
    expect(hasActiveEntitlement(entitlement('cancelled', '2040-02-01T00:00:00Z', false), 'qv_voyage_pass', now)).toBe(
      false
    )

    for (const status of ['cancelled_immediately', 'expired', 'revoked', 'inactive']) {
      expect(hasActiveEntitlement(entitlement(status), 'qv_voyage_pass', now)).toBe(false)
    }
  })

  it('reuses only an exact, unexpired Voyage checkout attempt', () => {
    const attempt = {
      checkoutAttemptId: '123e4567-e89b-42d3-a456-426614174000',
      createdAt: 1_000,
      period: 'monthly' as const,
      userId: 'user-1'
    }

    expect(reusableVoyageCheckoutAttempt(attempt, 'monthly', 'user-1', 2_000)).toBe(attempt)
    expect(reusableVoyageCheckoutAttempt(attempt, 'yearly', 'user-1', 2_000)).toBeNull()
    expect(reusableVoyageCheckoutAttempt(attempt, 'monthly', 'user-2', 2_000)).toBeNull()
    expect(reusableVoyageCheckoutAttempt(attempt, 'monthly', 'user-1', 3_602_000)).toBeNull()
    expect(
      reusableVoyageCheckoutAttempt({ ...attempt, checkoutAttemptId: 'not-a-uuid' }, 'monthly', 'user-1', 2_000)
    ).toBeNull()
  })

  it('connects a realtime channel once and closes deterministically', async () => {
    const adapter = {
      close: vi.fn(async () => undefined),
      connect: vi.fn(async () => ({ id: 'socket-1', userId: 'user-1' })),
      send: vi.fn(async () => undefined)
    }

    const channel = createRealtimeChannel(adapter)
    await channel.send(1001, { slug: 'weekly-cup' })
    await channel.send(1002, { slug: 'weekly-cup' })
    await channel.close()
    expect(adapter.connect).toHaveBeenCalledTimes(1)
    expect(adapter.send).toHaveBeenCalledTimes(2)
    expect(adapter.close).toHaveBeenCalledWith('socket-1')
  })

  it('scores repeated Daily Word letters and exports the source share grid', () => {
    expect(scoreWord('APPLE', 'ALLEY')).toEqual(['correct', 'present', 'absent', 'present', 'absent'])
    expect(wordShareGrid('APPLE', ['ALLEY'])).toBe('🟩🟨⬛🟨⬛')
  })

  it('keeps Groups puzzles partitioned into four exact groups', () => {
    for (const puzzle of WORD_GROUP_PUZZLES) {
      expect(puzzle).toHaveLength(4)
      expect(puzzle.flatMap(group => group.words)).toHaveLength(16)
      expect(new Set(puzzle.flatMap(group => group.words)).size).toBe(16)
    }
  })

  it('validates Spell center, pool, source list, pangram, and scoring', () => {
    const puzzle = SPELL_PUZZLES[0]!
    expect(validateSpellWord('CAPITOL', puzzle)).toBeNull()
    expect(validateSpellWord('CLAP', puzzle)).toMatch(/must use T/)
    expect(validateSpellWord('TAXI', puzzle)).toMatch(/outside/)
    expect(isPangram('CAPITOL', puzzle)).toBe(true)
    expect(spellScore(['TAIL', 'CAPITOL'], puzzle)).toBe(15)
  })

  it('ships internally consistent source crossword grids and clues', () => {
    expect(crosswordCleanSolveEligible(true, false)).toBe(true)
    expect(crosswordCleanSolveEligible(true, true)).toBe(false)

    for (const puzzle of CROSSWORD_PUZZLES) {
      for (const clue of puzzle.clues.across) {
        expect(puzzle.grid[clue.row]!.slice(clue.col, clue.col + clue.len).join('')).toBe(clue.answer)
      }

      for (const clue of puzzle.clues.down) {
        expect(Array.from({ length: clue.len }, (_, index) => puzzle.grid[clue.row + index]![clue.col]).join('')).toBe(
          clue.answer
        )
      }
    }
  })

  it('runs deterministic Imposter assignment and private-vote result rules', () => {
    const assigned = imposterIndices(4, 1, 123)
    expect(assigned).toHaveLength(1)
    const imposter = assigned[0]!
    expect(imposterResult({ 0: imposter, 1: imposter, 2: imposter, 3: 0 }, assigned)).toMatchObject({
      caught: true,
      ejected: imposter,
      imposterWin: false,
      tied: false
    })
    expect(imposterResult({ 0: 1, 1: 0 }, assigned).tied).toBe(true)
  })

  it('builds deterministic Voyage theme, seeds, and searchable grids', () => {
    const date = new Date('2026-05-25T12:00:00Z')
    expect(voyageTheme(date).words).toContain('ORBIT')
    expect(voyageSeed('search', date)).toBe(voyageSeed('search', date))
    const first = buildWordSearch(['MARS', 'MOON', 'ORBIT'], 42)
    const second = buildWordSearch(['MARS', 'MOON', 'ORBIT'], 42)
    expect(first).toEqual(second)
    expect(first.placements).toHaveLength(3)

    for (const placement of first.placements) {
      expect(placement.cells.map(([row, column]) => first.grid[row]![column]).join('')).toBe(placement.word)
    }
  })

  it('keeps every Voyage theme playable across all six source mini-games', () => {
    for (const theme of VOYAGE_THEMES) {
      expect(theme.trivia.length).toBeGreaterThanOrEqual(10)
      expect(
        theme.trivia.every(
          question =>
            question.options.length === 4 &&
            question.correctIndex >= 0 &&
            question.correctIndex < question.options.length
        )
      ).toBe(true)
      expect(new Set(theme.icons).size).toBe(theme.icons.length)
      expect(theme.pictures.length).toBeGreaterThanOrEqual(4)
      expect(theme.wordTargets.every(word => /^[A-Z]+$/.test(word))).toBe(true)
      expect(theme.words.every(word => /^[A-Z]+$/.test(word))).toBe(true)
    }
  })
})
