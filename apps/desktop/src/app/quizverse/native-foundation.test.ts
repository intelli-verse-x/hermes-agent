// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { dailyContent, fnv1a32, seededShuffle, utcDay } from './engines/daily-content'
import { $nativeStreak, completeStreakDay } from './engines/streak-store'
import { createSubmissionMachine } from './engines/submission-fsm'
import { NATIVE_SURFACES } from './native-contracts'

describe('QuizVerse native foundation', () => {
  beforeEach(() => {
    localStorage.clear()
    $nativeStreak.set({ best: 0, current: 0, lastCompletedDay: null })
  })

  it('selects identical daily content for every instant in one UTC day', () => {
    const values = ['a', 'b', 'c']
    const morning = dailyContent('words', values, new Date('2026-07-13T00:00:01Z'))
    const evening = dailyContent('words', values, new Date('2026-07-13T23:59:59Z'))

    expect(morning).toEqual(evening)
    expect(utcDay(new Date('2026-07-13T23:59:59Z'))).toBe('2026-07-13')
    expect(fnv1a32('stable')).toBe(fnv1a32('stable'))
  })

  it('shuffles deterministically without mutating bundled content', () => {
    const source = ['a', 'b', 'c', 'd']
    const first = seededShuffle(source, 42)

    expect(first).toEqual(seededShuffle(source, 42))
    expect(source).toEqual(['a', 'b', 'c', 'd'])
    expect(new Set(first)).toEqual(new Set(source))
  })

  it('deduplicates in-flight writes and retains the idempotency key on retry', async () => {
    let release!: (value: string) => void

    const write = vi.fn(
      () =>
        new Promise<string>(resolve => {
          release = resolve
        })
    )

    const machine = createSubmissionMachine(write)
    const first = machine.submit({ answer: 1 })
    const second = machine.submit({ answer: 1 })

    expect(first).toBe(second)
    expect(write).toHaveBeenCalledTimes(1)
    release('ok')
    await expect(first).resolves.toBe('ok')
    expect(machine.state.get()).toEqual(expect.objectContaining({ phase: 'submitted', result: 'ok' }))
  })

  it('advances streak only once per UTC day and continues on the next day', () => {
    const scope = { kind: 'words', mode: 'daily', skin: 'general' } as const
    completeStreakDay(scope, new Date('2026-07-12T23:00:00Z'))
    completeStreakDay(scope, new Date('2026-07-12T23:59:00Z'))
    const next = completeStreakDay(scope, new Date('2026-07-13T01:00:00Z'))

    expect(next).toEqual({ best: 2, current: 2, lastCompletedDay: '2026-07-13' })
  })

  it('isolates Words mode, skin, duel exam, and Voyage streaks', () => {
    const day = new Date('2026-07-13T01:00:00Z')

    expect(completeStreakDay({ kind: 'words', mode: 'daily', skin: 'general' }, day).current).toBe(1)
    expect(completeStreakDay({ kind: 'words', mode: 'daily', skin: 'gre-easy' }, day).current).toBe(1)
    expect(completeStreakDay({ exam: 'gre', kind: 'words', mode: 'duel', skin: 'general' }, day).current).toBe(1)
    expect(completeStreakDay({ exam: 'sat', kind: 'words', mode: 'duel', skin: 'general' }, day).current).toBe(1)
    expect(completeStreakDay({ kind: 'voyage' }, day).current).toBe(1)
  })

  it('gives every audited surface native routes and explicit write contracts', () => {
    const ids = NATIVE_SURFACES.map(surface => surface.id)
    const writes = NATIVE_SURFACES.flatMap(surface => surface.routes.filter(route => route.write))

    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toEqual(
      expect.arrayContaining([
        'words',
        'voyage',
        'tournaments',
        'link-play',
        'brain',
        'notes',
        'live',
        'voice',
        'onboarding',
        'shell',
        'tutorx'
      ])
    )
    expect(NATIVE_SURFACES.every(surface => surface.routes.length > 0)).toBe(true)
    expect(writes.every(route => Boolean(route.protocol))).toBe(true)
  })
})
