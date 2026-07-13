import { atom } from 'nanostores'

import { utcDay } from './daily-content'

export interface StreakState {
  best: number
  current: number
  lastCompletedDay: null | string
}

export type WordsStreakMode = 'crossword' | 'daily' | 'duel' | 'groups' | 'imposter' | 'spell'
export type WordsStreakSkin = 'general' | 'gre-easy'
export type StreakScope =
  | { exam?: string; kind: 'words'; mode: WordsStreakMode; skin: WordsStreakSkin }
  | { kind: 'voyage' }

function storageKey(scope: StreakScope): string {
  return scope.kind === 'voyage'
    ? 'quizverse_voyage_streak_v1'
    : `quizverse_words_streak_v1:${scope.skin}:${scope.mode}${scope.mode === 'duel' ? `:${scope.exam ?? 'gre'}` : ''}`
}

function load(scope: StreakScope): StreakState {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey(scope)) ?? '')

    if (Number.isInteger(parsed.best) && Number.isInteger(parsed.current)) {
      return {
        best: Math.max(0, parsed.best),
        current: Math.max(0, parsed.current),
        lastCompletedDay: typeof parsed.lastCompletedDay === 'string' ? parsed.lastCompletedDay : null
      }
    }
  } catch {
    // A damaged local streak starts clean and never blocks play.
  }

  return { best: 0, current: 0, lastCompletedDay: null }
}

export const $nativeStreak = atom<StreakState>({ best: 0, current: 0, lastCompletedDay: null })

export function getStreak(scope: StreakScope): StreakState {
  return load(scope)
}

export function completeStreakDay(scope: StreakScope, date = new Date()): StreakState {
  const day = utcDay(date)
  const previous = load(scope)

  if (previous.lastCompletedDay === day) {
    return previous
  }

  const yesterday = new Date(`${day}T00:00:00.000Z`)
  yesterday.setUTCDate(yesterday.getUTCDate() - 1)
  const current = previous.lastCompletedDay === utcDay(yesterday) ? previous.current + 1 : 1
  const next = { best: Math.max(previous.best, current), current, lastCompletedDay: day }

  localStorage.setItem(storageKey(scope), JSON.stringify(next))
  $nativeStreak.set(next)

  return next
}
