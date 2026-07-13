// @vitest-environment jsdom

import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { NativePlay } from './native-play'
import { NativeTutorSurface } from './native-tutor'
import { fetchPlayQuestions, PLAY_MODES } from './play-store'

describe('native QuizVerse products', () => {
  beforeEach(() => {
    localStorage.clear()
    Object.defineProperty(window, 'hermesDesktop', {
      configurable: true,
      value: {
        quizverse: {
          playRpc: vi.fn(async () => ({ fallback_to_client: true })),
          playSession: vi.fn(async () => ({ deviceId: 'device-1', userId: 'guest-1', username: 'Guest' })),
          tutorStart: vi.fn(async () => ({ apiUrl: 'http://localhost:18111', mode: 'remote', state: 'running' })),
          tutorStatus: vi.fn(async () => ({ apiUrl: 'http://localhost:18111', mode: 'remote', state: 'running' }))
        }
      }
    })
    Object.assign(window.hermesDesktop.quizverse!, {
      playRpc: vi.fn(async () => ({ fallback_to_client: true })),
      playSession: vi.fn(async () => ({ deviceId: 'device-1', userId: 'guest-1', username: 'Guest' }))
    })

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input)

        if (url.includes('/quiz-verse/daily/dailyquiz-')) {
          return Response.json({
            today_quiz: {
              questions: [
                { correct_answer: 1, id: 'daily-1', options: ['A', 'B', 'C'], question: 'Daily question?' }
              ]
            }
          })
        }

        if (url.includes('/knowledge/list')) {
          return Response.json([])
        }

        if (url.includes('/sessions')) {
          return Response.json({ sessions: [] })
        }

        return Response.json({ entries: [], items: [], progress: [] })
      })
    )
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('keeps the Play registry table-driven with unique mode ids', () => {
    const ids = PLAY_MODES.map(mode => mode.id)

    expect(new Set(ids).size).toBe(ids.length)
    expect(PLAY_MODES.length).toBeGreaterThan(25)
  })

  it('explains every native unavailable mode', () => {
    const unavailable = PLAY_MODES.filter(mode => !mode.available)

    expect(unavailable.length).toBeGreaterThan(0)
    expect(unavailable.every(mode => Boolean(mode.reason?.trim()))).toBe(true)
  })

  it('routes every playable mode through a native question source', () => {
    const playable = PLAY_MODES.filter(mode => mode.available)

    expect(playable.every(mode => mode.source !== undefined)).toBe(true)
    expect(playable.some(mode => mode.source === 'ai')).toBe(true)
    expect(playable.some(mode => mode.source === 'daily')).toBe(true)
    expect(playable.some(mode => mode.source === 'bank')).toBe(true)
    expect(['live-arena', 'party', 'ai-chat', 'sync-beat'].map(id =>
      PLAY_MODES.find(mode => mode.id === id)?.available
    )).toEqual([true, true, true, true])
  })

  it('uses the daily client pool when Nakama requests client fallback', async () => {
    const daily = PLAY_MODES.find(mode => mode.id === 'daily')!
    const result = await fetchPlayQuestions(daily)

    expect(result.questions).toEqual([
      expect.objectContaining({ correctIndex: 1, id: 'daily-1', prompt: 'Daily question?' })
    ])
    expect(window.hermesDesktop.quizverse!.playRpc).toHaveBeenCalledWith(
      'quizverse_get_questions',
      expect.objectContaining({ inline_questions: expect.any(Array), mode: 'DailyQuiz' })
    )
    expect(localStorage.getItem('quizverse_nakama_session')).toBeNull()
  })

  it('renders Play and all learning tabs without webviews or iframes', async () => {
    const play = render(<NativePlay />)

    await waitFor(() => expect(play.container.textContent).toContain('Native question-pack play'))
    expect(play.container.querySelector('webview')).toBeNull()
    expect(play.container.querySelector('iframe')).toBeNull()
    play.unmount()

    for (const surface of ['tutor', 'knowledge', 'memory', 'learning'] as const) {
      const view = render(<NativeTutorSurface surface={surface} />)

      await waitFor(() => expect(view.container.textContent?.length).toBeGreaterThan(0))
      expect(view.container.querySelector('webview')).toBeNull()
      expect(view.container.querySelector('iframe')).toBeNull()
      view.unmount()
    }
  })
})
