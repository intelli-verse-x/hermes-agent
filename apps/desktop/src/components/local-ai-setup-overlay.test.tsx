import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  $localAi,
  type LocalAiProgress,
  type LocalAiRendererBridge,
  type LocalAiStatus,
  resetLocalAiStore
} from '@/store/local-ai'

import { LocalAiSetupOverlay } from './local-ai-setup-overlay'

const status: LocalAiStatus = {
  available: true,
  setupRequired: true,
  mode: null,
  runtime: { state: 'not-installed' },
  model: null,
  routeHealth: 'unavailable',
  storage: { usedBytes: 0, availableBytes: 10_000 },
  cloudEscalations: 0,
  tokensAvoided: 0
}

let progressListener: ((progress: LocalAiProgress) => void) | undefined

function bridge(): LocalAiRendererBridge {
  const ok = vi.fn().mockResolvedValue({ ok: true })

  return {
    getStatus: vi.fn().mockResolvedValue(status),
    getRecommendation: vi.fn().mockResolvedValue({
      modelId: 'model',
      displayName: 'Model',
      rationale: 'Fits',
      acceleration: 'cpu',
      downloadBytes: 100,
      diskBytes: 200,
      memoryBytes: 300,
      contextTokens: 4096
    }),
    setMode: ok,
    setTelemetryEnabled: ok,
    install: ok,
    cancel: ok,
    retry: ok,
    verify: ok,
    repair: ok,
    changeModel: ok,
    reinstall: ok,
    uninstall: ok,
    onProgress: listener => {
      progressListener = listener

      return () => {
        progressListener = undefined
      }
    }
  }
}

beforeEach(() => {
  resetLocalAiStore()
  window.hermesDesktop = { localAi: bridge() } as typeof window.hermesDesktop
})

afterEach(() => {
  cleanup()
  resetLocalAiStore()
  progressListener = undefined
})

describe('LocalAiSetupOverlay accessibility', () => {
  it('focuses the title and traps Tab and Shift+Tab inside the modal', async () => {
    render(<LocalAiSetupOverlay />)
    const title = await screen.findByRole('heading', { name: /Choose how/ })

    await waitFor(() => expect(document.activeElement).toBe(title))
    fireEvent.keyDown(title, { key: 'Tab' })
    expect((document.activeElement as HTMLElement).closest('[role="dialog"]')).toBeTruthy()
    fireEvent.keyDown(document.activeElement!, { key: 'Tab', shiftKey: true })
    expect((document.activeElement as HTMLElement).closest('[role="dialog"]')).toBeTruthy()
  })

  it('keeps mandatory setup open on Escape and returns focus when a closable dialog exits', async () => {
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    const onCompleted = vi.fn()
    const view = render(<LocalAiSetupOverlay forceOpen onCompleted={onCompleted} />)

    await screen.findByRole('dialog')
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { name: /Choose how/ })))
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(onCompleted).toHaveBeenCalledOnce())
    view.unmount()
    expect(document.activeElement).toBe(opener)
    opener.remove()
  })

  it('announces detailed progress without moving focus', async () => {
    render(<LocalAiSetupOverlay />)
    const title = await screen.findByRole('heading', { name: /Choose how/ })
    await waitFor(() => expect(progressListener).toBeTypeOf('function'))
    fireEvent.click(screen.getByRole('button', { name: /Local first/ }))
    fireEvent.click(screen.getByRole('button', { name: /Download and set up/ }))
    await screen.findByText('Installing local AI')
    await act(async () => {
      $localAi.set({
        ...$localAi.get(),
        progress: {
        stage: 'downloading',
        message: 'Downloading verified model…',
        percent: 42,
        completedBytes: 42,
        totalBytes: 100
        }
      })
    })

    expect(await screen.findByText('Downloading verified model…')).toBeTruthy()
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('42')
    expect(document.activeElement).toBe(title)
  })
})
