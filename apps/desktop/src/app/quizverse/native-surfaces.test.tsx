// @vitest-environment jsdom

import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { utcDay } from './engines/daily-content'
import { NATIVE_SURFACES } from './native-contracts'
import { openNativeSurface } from './native-surface-store'
import { NativeSurfaceRouter } from './native-surfaces'

describe('QuizVerse native surface router', () => {
  beforeEach(() => {
    localStorage.clear()
    Object.defineProperty(window, 'hermesDesktop', {
      configurable: true,
      value: {
        quizverse: {
          authStatus: vi.fn(async () => ({
            authenticated: true,
            configured: true,
            userId: 'test-user',
            username: 'Tester'
          })),
          playRpc: vi.fn(async () => ({ success: true })),
          playRealtimeClose: vi.fn(async () => undefined),
          playRealtimeConnect: vi.fn(async () => ({ id: 'socket-1', userId: 'test-user' })),
          playRealtimeJoinMatch: vi.fn(async () => ({ matchId: 'match-1', presences: [], self: {} })),
          playRealtimeSend: vi.fn(async () => undefined),
          playSession: vi.fn(async () => ({ deviceId: 'test-device', userId: 'test-user', username: 'Guest' })),
          productRequest: vi.fn(async () => ({
            body: JSON.stringify({ checkout_url: 'https://checkout.stripe.com/c/pay/test' }),
            contentType: 'application/json',
            status: 200
          })),
          productStream: vi.fn(async (_input, onChunk) => {
            onChunk('data: {"delta":"Streaming answer"}\n\n')

            return { body: 'data: {"delta":"Streaming answer"}\n\n', contentType: 'text/event-stream', status: 200 }
          }),
          productCancel: vi.fn(async () => undefined)
        },
        onDeepLink: vi.fn(() => () => undefined),
        openExternal: vi.fn(async () => undefined),
        requestMicrophoneAccess: vi.fn(async () => true)
      }
    })
  })

  afterEach(cleanup)

  it('renders every route without hosted browsing primitives', () => {
    for (const surface of NATIVE_SURFACES) {
      for (const route of surface.routes) {
        openNativeSurface(surface.id, route.id)
        const view = render(<NativeSurfaceRouter onBack={vi.fn()} />)

        expect(view.container.textContent).toContain(route.id.replaceAll('-', ' '))
        expect(view.container.querySelector('webview')).toBeNull()
        expect(view.container.querySelector('iframe')).toBeNull()
        expect(view.container.querySelector('a[href^="http"]')).toBeNull()
        view.unmount()
      }
    }
  })

  it('completes the daily word with keyboard-accessible native controls', async () => {
    openNativeSurface('words', 'daily')
    const view = render(<NativeSurfaceRouter onBack={vi.fn()} />)
    const input = await view.findByLabelText('Five-letter guess')

    fireEvent.change(input, { target: { value: 'SOLAR' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(view.getByLabelText('Daily word attempts')).toBeTruthy()
  })

  it('enforces Voyage cooldowns without simulating a rewarded ad', () => {
    localStorage.setItem(
      `qv_voyage_progress_v3:${utcDay()}`,
      JSON.stringify({
        completed: ['trivia'],
        cooldowns: { memory: Date.now() + 60_000 },
        hintsUsed: 0,
        scores: { trivia: 8 }
      })
    )
    openNativeSurface('voyage', 'memory')
    const view = render(<NativeSurfaceRouter onBack={vi.fn()} />)

    expect(view.getByText('Ship traveling')).toBeTruthy()
    expect(view.getByText(/no ad is simulated/i)).toBeTruthy()
    expect(view.queryByText(/skip cooldown/i)).toBeNull()
  })

  it('requires purchase acknowledgement before system-browser Stripe checkout', async () => {
    openNativeSurface('voyage', 'pass')
    const view = render(<NativeSurfaceRouter onBack={vi.fn()} />)
    const setup = view.getByRole('button', { name: 'Continue to Stripe Checkout' })

    expect((setup as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(view.getByRole('checkbox'))
    expect((setup as HTMLButtonElement).disabled).toBe(false)
    fireEvent.click(setup)
    await vi.waitFor(() =>
      expect(window.hermesDesktop.openExternal).toHaveBeenCalledWith('https://checkout.stripe.com/c/pay/test')
    )
  })

  it('requires a second explicit action before tournament enrollment', () => {
    openNativeSurface('tournaments', 'enroll')
    const view = render(<NativeSurfaceRouter onBack={vi.fn()} />)

    expect(view.getByText('Confirmation required')).toBeTruthy()
    expect(window.hermesDesktop.quizverse!.playRpc).not.toHaveBeenCalled()
  })

  it('renders bracket, certificate, referral, learning, and realtime pot as native tournament UI', async () => {
    localStorage.setItem('qv_tournament_selected_v1', 'weekly-cup')
    localStorage.setItem(
      'qv_tournament_certificate_v1:weekly-cup',
      JSON.stringify({
        id: 'cert-1',
        idempotencyKey: '123e4567-e89b-42d3-a456-426614174000'
      })
    )
    vi.mocked(window.hermesDesktop.quizverse!.playRpc).mockImplementation(async name => {
      if (name === 'tournament_bracket_state') {
        return {
          data: {
            bracket_id: 'br-1',
            exists: true,
            public_dashboard_url: 'https://bracket.intelli-verse-x.ai/tournament/br-1',
            round: 2,
            total_rounds: 4
          }
        }
      }

      if (name === 'certificate_get') {
        return {
          data: {
            certificate: {
              id: 'cert-1',
              player_username: 'Ada',
              tournament_name: 'Weekly Cup'
            }
          }
        }
      }

      if (name === 'referral_my_code') {
        return { code: 'ADA123', url: 'https://quizverse.world/r/ADA123' }
      }

      if (name === 'learning_track_get') {
        return {
          data: {
            track: {
              topic_tag: 'quiz rules',
              track_id: 'track-1',
              videos: [{ completed: true, id: 'l1', title: 'Rules' }]
            }
          }
        }
      }

      if (name === 'tournament_get') {
        return { entries_count: 12, pot_bc: 500, title: 'Weekly Cup' }
      }

      return { success: true }
    })

    for (const [route, expected] of [
      ['bracket', 'Round 2 of 4'],
      ['certificate', 'Ada'],
      ['referral', 'ADA123'],
      ['learning', 'Rules'],
      ['detail', 'Live pot: 500 BC']
    ]) {
      openNativeSurface('tournaments', route)
      const view = render(<NativeSurfaceRouter onBack={vi.fn()} />)
      await waitFor(() => expect(view.container.textContent).toContain(expected))
      expect(view.container.querySelector('pre')).toBeNull()
      view.unmount()
    }

    expect(window.hermesDesktop.quizverse!.playRpc).toHaveBeenCalledWith('certificate_get', { id: 'cert-1' })
  })

  it('streams Link & Play chat incrementally and supports cancellation plumbing', async () => {
    localStorage.setItem('qv_lap_selected_note_v1', 'note-1')
    vi.mocked(window.hermesDesktop.quizverse!.productRequest).mockImplementation(async input => ({
      body: input.path.includes('with-chat') ? '{"chat":{"id":"chat-1"}}' : '{}',
      contentType: 'application/json',
      status: 200
    }))
    openNativeSurface('link-play', 'chat')
    const view = render(<NativeSurfaceRouter onBack={vi.fn()} />)
    const input = await view.findByLabelText('Chat message')
    fireEvent.change(input, { target: { value: 'Explain this' } })
    fireEvent.submit(input.closest('form')!)
    await waitFor(() => expect(view.container.textContent).toContain('Streaming answer'))
    expect(window.hermesDesktop.quizverse!.productStream).toHaveBeenCalledWith(
      expect.objectContaining({ path: expect.stringContaining('/stream?message=Explain%20this') }),
      expect.any(Function)
    )
  })
})
