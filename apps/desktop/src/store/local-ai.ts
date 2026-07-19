import { atom } from 'nanostores'

export type LocalAiMode = 'local-first' | 'local-only' | 'cloud-only'
export type LocalAiRuntimeState = 'not-installed' | 'stopped' | 'starting' | 'ready' | 'degraded' | 'error'
export type LocalAiRouteHealth = 'healthy' | 'degraded' | 'unavailable' | 'not-applicable'
export type LocalAiAction =
  | 'loading'
  | 'choosing-mode'
  | 'installing'
  | 'cancelling'
  | 'retrying'
  | 'verifying'
  | 'repairing'
  | 'changing-model'
  | 'reinstalling'
  | 'uninstalling'

export interface LocalAiRecommendation {
  modelId: string
  displayName: string
  rationale: string
  acceleration: string
  downloadBytes: number
  diskBytes: number
  memoryBytes: number
  contextTokens: number
}

export interface LocalAiStatus {
  available: boolean
  setupRequired: boolean
  mode: LocalAiMode | null
  runtime: {
    state: LocalAiRuntimeState
    version?: string
    endpoint?: string
    lastVerifiedAt?: string
    error?: string
  }
  model: {
    id: string
    displayName: string
    revision?: string
  } | null
  routeHealth: LocalAiRouteHealth
  routeStatus?: {
    label: string
    localReady: boolean
    cloudFallbacks: number
  }
  storage: {
    usedBytes: number
    availableBytes: number
    location?: string
  }
  cloudEscalations: number
  tokensAvoided: number
  estimatedTokensAvoided?: number
  measuredLocalTokens?: number
  tokenMeasurement?: 'runtime-reported' | 'estimated' | null
  tokenBaseline?: string
  tokenSavingsPeriodStartedAt?: string
  telemetryEnabled?: boolean
  attempts?: Array<{
    modelId: string
    modelDisplayName: string
    phase: 'candidate' | 'runtime-repair'
    status: 'running' | 'failed' | 'verified'
    startedAt: string
    finishedAt?: string
    reason?: string
  }>
}

export interface LocalAiProgress {
  stage: 'preparing' | 'downloading' | 'verifying' | 'installing' | 'starting' | 'complete' | 'cancelled' | 'error'
  message: string
  completedBytes?: number
  totalBytes?: number
  percent?: number
  etaSeconds?: number
  error?: string
  attemptIndex?: number
  attemptTotal?: number
  attemptModel?: string
  attemptPhase?: 'candidate' | 'runtime-repair'
}

export interface LocalAiActionResult {
  ok: boolean
  message?: string
}

/**
 * Renderer-owned draft of the future preload contract. Keep this structural:
 * global.d.ts can adopt or adapt it later without making these renderer files
 * depend on an Electron implementation detail.
 */
export interface LocalAiRendererBridge {
  getStatus(): Promise<LocalAiStatus>
  getRecommendation(): Promise<LocalAiRecommendation | null>
  setMode(mode: LocalAiMode): Promise<LocalAiActionResult>
  setTelemetryEnabled(enabled: boolean): Promise<LocalAiActionResult>
  install(input: { mode: Exclude<LocalAiMode, 'cloud-only'>; modelId: string }): Promise<LocalAiActionResult>
  cancel(): Promise<LocalAiActionResult>
  retry(): Promise<LocalAiActionResult>
  verify(): Promise<LocalAiActionResult>
  repair(): Promise<LocalAiActionResult>
  changeModel(modelId?: string): Promise<LocalAiActionResult>
  reinstall(): Promise<LocalAiActionResult>
  uninstall(): Promise<LocalAiActionResult>
  onProgress(listener: (progress: LocalAiProgress) => void): (() => void) | void
}

export interface LocalAiStoreState {
  status: LocalAiStatus | null
  recommendation: LocalAiRecommendation | null
  progress: LocalAiProgress | null
  action: LocalAiAction | null
  initialized: boolean
  error: string | null
}

const INITIAL: LocalAiStoreState = {
  status: null,
  recommendation: null,
  progress: null,
  action: null,
  initialized: false,
  error: null
}

export const $localAi = atom<LocalAiStoreState>(INITIAL)

let progressUnsubscribe: (() => void) | null = null

function bridge(): LocalAiRendererBridge | null {
  if (typeof window === 'undefined') {
    return null
  }

  return (
    (
      window.hermesDesktop as unknown as {
        localAi?: LocalAiRendererBridge
      }
    )?.localAi ?? null
  )
}

function patch(update: Partial<LocalAiStoreState>) {
  $localAi.set({ ...$localAi.get(), ...update })
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function requireBridge(): LocalAiRendererBridge {
  const api = bridge()

  if (!api) {
    throw new Error('Local AI is not available in this desktop build.')
  }

  return api
}

async function refreshFrom(api: LocalAiRendererBridge): Promise<LocalAiStatus> {
  const status = await api.getStatus()
  patch({ status })

  return status
}

export async function initializeLocalAi(): Promise<void> {
  if ($localAi.get().action === 'loading') {
    return
  }

  const api = bridge()

  if (!api) {
    patch({ initialized: true, error: 'Local AI is not available in this desktop build.' })

    return
  }

  patch({ action: 'loading', error: null })

  try {
    const [status, recommendation] = await Promise.all([api.getStatus(), api.getRecommendation()])
    patch({ status, recommendation, initialized: true, action: null })

    if (!progressUnsubscribe) {
      progressUnsubscribe =
        api.onProgress(progress => {
          patch({ progress, error: progress.stage === 'error' ? progress.error || progress.message : null })

          if (progress.stage === 'complete' || progress.stage === 'cancelled') {
            patch({ action: null })
            void refreshLocalAi()
          }
        }) ?? null
    }
  } catch (error) {
    patch({ initialized: true, action: null, error: errorMessage(error) })
  }
}

export async function refreshLocalAi(): Promise<LocalAiStatus | null> {
  try {
    const status = await refreshFrom(requireBridge())
    patch({ error: null })

    return status
  } catch (error) {
    patch({ error: errorMessage(error) })

    return null
  }
}

async function runAction(
  action: LocalAiAction,
  operation: (api: LocalAiRendererBridge) => Promise<LocalAiActionResult>,
  options: { clearProgress?: boolean; keepActionOnSuccess?: boolean; refresh?: boolean } = {}
): Promise<LocalAiActionResult> {
  patch({
    action,
    error: null,
    ...(options.clearProgress ? { progress: null } : {})
  })

  try {
    const api = requireBridge()
    const result = await operation(api)

    if (!result.ok) {
      throw new Error(result.message || 'Local AI action failed.')
    }

    if (options.refresh !== false) {
      await refreshFrom(api)
    }

    if (!options.keepActionOnSuccess) {
      patch({ action: null })
    }

    return result
  } catch (error) {
    const message = errorMessage(error)
    patch({ action: null, error: message })

    return { ok: false, message }
  }
}

export function chooseLocalAiMode(mode: LocalAiMode) {
  return runAction('choosing-mode', api => api.setMode(mode))
}

export function setLocalAiTelemetryEnabled(enabled: boolean) {
  return runAction('choosing-mode', api => api.setTelemetryEnabled(enabled))
}

export async function installLocalAi(mode: Exclude<LocalAiMode, 'cloud-only'>, modelId?: string) {
  const selectedModelId = modelId ?? $localAi.get().recommendation?.modelId

  if (!selectedModelId) {
    const message = 'No compatible local model recommendation is available.'
    patch({ error: message })

    return { ok: false, message }
  }

  return runAction('installing', api => api.install({ mode, modelId: selectedModelId }), {
    clearProgress: true,
    keepActionOnSuccess: true,
    refresh: false
  })
}

export function cancelLocalAiInstall() {
  return runAction('cancelling', api => api.cancel())
}

export function retryLocalAiInstall() {
  return runAction('retrying', api => api.retry(), {
    clearProgress: true,
    keepActionOnSuccess: true,
    refresh: false
  })
}

export function verifyLocalAi() {
  return runAction('verifying', api => api.verify())
}

export function repairLocalAi() {
  return runAction('repairing', api => api.repair(), { clearProgress: true })
}

export function changeLocalAiModel(modelId?: string) {
  return runAction('changing-model', api => api.changeModel(modelId), { clearProgress: true })
}

export function reinstallLocalAi() {
  return runAction('reinstalling', api => api.reinstall(), {
    clearProgress: true,
    keepActionOnSuccess: true,
    refresh: false
  })
}

export function uninstallLocalAi() {
  return runAction('uninstalling', api => api.uninstall(), { clearProgress: true })
}

/** Test/dev cleanup; production callers normally keep the subscription for the window lifetime. */
export function resetLocalAiStore() {
  progressUnsubscribe?.()
  progressUnsubscribe = null
  $localAi.set(INITIAL)
}
