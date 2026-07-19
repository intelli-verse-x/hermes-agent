import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  $localAi,
  chooseLocalAiMode,
  initializeLocalAi,
  installLocalAi,
  type LocalAiProgress,
  type LocalAiRendererBridge,
  type LocalAiStatus,
  resetLocalAiStore
} from './local-ai'

const READY_STATUS: LocalAiStatus = {
  available: true,
  setupRequired: true,
  mode: null,
  runtime: { state: 'not-installed' },
  model: null,
  routeHealth: 'unavailable',
  storage: { usedBytes: 0, availableBytes: 50_000_000_000 },
  cloudEscalations: 0,
  tokensAvoided: 0
}

let progressListener: ((progress: LocalAiProgress) => void) | undefined
let api: LocalAiRendererBridge

beforeEach(() => {
  resetLocalAiStore()
  progressListener = undefined
  api = {
    getStatus: vi.fn().mockResolvedValue(READY_STATUS),
    getRecommendation: vi.fn().mockResolvedValue({
      modelId: 'hermes-3b-q4',
      displayName: 'Hermes 3B Q4',
      rationale: 'Fits available unified memory and uses Metal acceleration.',
      acceleration: 'metal',
      downloadBytes: 2_000_000_000,
      diskBytes: 2_500_000_000,
      memoryBytes: 4_000_000_000,
      contextTokens: 8192
    }),
    setMode: vi.fn().mockResolvedValue({ ok: true }),
    install: vi.fn().mockResolvedValue({ ok: true }),
    cancel: vi.fn().mockResolvedValue({ ok: true }),
    retry: vi.fn().mockResolvedValue({ ok: true }),
    verify: vi.fn().mockResolvedValue({ ok: true }),
    repair: vi.fn().mockResolvedValue({ ok: true }),
    setTelemetryEnabled: vi.fn().mockResolvedValue({ ok: true }),
    changeModel: vi.fn().mockResolvedValue({ ok: true }),
    reinstall: vi.fn().mockResolvedValue({ ok: true }),
    uninstall: vi.fn().mockResolvedValue({ ok: true }),
    onProgress: vi.fn(listener => {
      progressListener = listener

      return vi.fn()
    })
  }

  Object.defineProperty(window, 'hermesDesktop', {
    configurable: true,
    value: { localAi: api }
  })
})

describe('local AI store', () => {
  it('loads status and hardware recommendation and subscribes once', async () => {
    await initializeLocalAi()
    await initializeLocalAi()

    expect($localAi.get().status).toEqual(READY_STATUS)
    expect($localAi.get().recommendation?.modelId).toBe('hermes-3b-q4')
    expect(api.onProgress).toHaveBeenCalledTimes(1)
  })

  it('requires an explicit mode and installs the recommended model', async () => {
    await initializeLocalAi()
    await chooseLocalAiMode('local-only')
    await installLocalAi('local-only')

    expect(api.setMode).toHaveBeenCalledWith('local-only')
    expect(api.install).toHaveBeenCalledWith({ mode: 'local-only', modelId: 'hermes-3b-q4' })
    expect($localAi.get().action).toBe('installing')
  })

  it('publishes progress and preserves actionable errors', async () => {
    await initializeLocalAi()
    progressListener?.({
      stage: 'downloading',
      message: 'Downloading model',
      completedBytes: 500,
      totalBytes: 1000,
      percent: 50,
      etaSeconds: 20
    })

    expect($localAi.get().progress?.percent).toBe(50)

    progressListener?.({ stage: 'error', message: 'Checksum mismatch', error: 'The model could not be verified.' })

    expect($localAi.get().error).toBe('The model could not be verified.')
  })
})
