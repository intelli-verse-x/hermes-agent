import { execFile as execFileCallback } from 'node:child_process'
import crypto from 'node:crypto'
import { EventEmitter } from 'node:events'
import fs from 'node:fs/promises'
import net from 'node:net'
import path from 'node:path'
import { promisify } from 'node:util'

import { runCandidateReadinessLoop } from './attempt-loop'
import { type ModelCatalog, type ModelCatalogEntry, selectModel, validateCatalog } from './catalog'
import { cleanupPartialDownload, downloadModel } from './downloader'
import { probeExistingEndpoint } from './endpoint-probe'
import { probeHardware } from './hardware'
import { LocalAiPersistence } from './persistence'
import { ManagedLlamaSidecar, type ManagedSidecarOptions } from './sidecar'
import { fetchVerifiedModelCatalog } from './signed-catalog'
import { type HardwareProfile, LOCAL_AI_SCHEMA_VERSION } from './types'
import { removeLocalAiInstallation } from './uninstall'
import { verifyInference } from './verification'

const execFile = promisify(execFileCallback)
const GIB = 1024 ** 3
const READINESS_TTL_MS = 15 * 60_000

export type LocalAiPolicyMode = 'local-first' | 'local-only' | 'cloud-only'

export interface LocalAiProgress {
  stage: 'preparing' | 'downloading' | 'installing' | 'starting' | 'verifying' | 'complete' | 'cancelled' | 'error'
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

export interface LocalAiInstallAttempt {
  modelId: string
  modelDisplayName: string
  phase: 'candidate' | 'runtime-repair'
  status: 'running' | 'failed' | 'verified'
  startedAt: string
  finishedAt?: string
  reason?: string
}

interface RuntimeAsset {
  platform: NodeJS.Platform
  architecture: NodeJS.Architecture
  acceleration: string
  archive: 'tar.gz' | 'zip'
  executable: string
  url: string
  sizeBytes: number
  sha256: string
}

interface RuntimeCatalog {
  schemaVersion: 1
  runtime: 'llama.cpp'
  revision: string
  assets: RuntimeAsset[]
}

interface ControllerState {
  schemaVersion: 1
  mode: LocalAiPolicyMode | null
  modelId?: string
  modelDisplayName?: string
  modelRevision?: string
  contextTokens?: number
  endpointMode?: 'existing' | 'managed'
  endpoint?: string
  apiKey?: string
  runtimeVersion?: string
  executablePath?: string
  modelPath?: string
  launchSpec?: {
    acceleration: string
    contextTokens: number
    threads: number
    extraArgs: string[]
  }
  externalModel?: {
    endpointName: string
    advertisedId: string
    capabilities: Array<'chat' | 'tools'>
    verifiedContextTokens: number
  }
  lastVerifiedAt?: string
  cloudEscalations: number
  tokensAvoided: number
  runtimeReportedTokens: number
  estimatedTokensAvoided: number
  measuredLocalTokens: number
  telemetryEnabled: boolean
  savingsPeriodStartedAt: string
  attempts: LocalAiInstallAttempt[]
}

export interface LocalAiControllerOptions {
  dataRoot: string
  assetsRoot: string
  fetchImpl?: typeof fetch
  emit?: (progress: LocalAiProgress) => void
  createSidecar?: (options: ManagedSidecarOptions) => ManagedLlamaSidecar
  probeHardware?: () => Promise<HardwareProfile>
  freeDiskBytes?: (directory: string) => Promise<number>
}

function humanGiB(bytes: number): string {
  return `${(bytes / GIB).toFixed(bytes >= 10 * GIB ? 0 : 1)} GB`
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await fs.readFile(filePath, 'utf8')) as T
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  const temporary = `${filePath}.${process.pid}.tmp`
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  await fs.rename(temporary, filePath)
}

async function extractRuntimeArchive(
  archivePath: string,
  destination: string,
  archive: RuntimeAsset['archive'],
  platform: NodeJS.Platform = process.platform,
  execute: typeof execFile = execFile
): Promise<void> {
  if (archive === 'tar.gz') {
    await execute('tar', ['-xf', archivePath, '-C', destination], {
      timeout: 120_000,
      windowsHide: true
    })

    return
  }

  if (platform === 'win32') {
    await execute(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Expand-Archive -LiteralPath $env:HERMES_RUNTIME_ARCHIVE_PATH -DestinationPath $env:HERMES_RUNTIME_DESTINATION -Force'
      ],
      {
        env: {
          ...process.env,
          HERMES_RUNTIME_ARCHIVE_PATH: archivePath,
          HERMES_RUNTIME_DESTINATION: destination
        },
        timeout: 120_000,
        windowsHide: true
      }
    )

    return
  }

  await execute('unzip', ['-q', archivePath, '-d', destination], {
    timeout: 120_000,
    windowsHide: true
  })
}

async function freeDiskBytes(directory: string): Promise<number> {
  await fs.mkdir(directory, { recursive: true })
  const stat = await fs.statfs(directory)

  return Number(stat.bavail) * Number(stat.bsize)
}

async function reserveLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close(error => (error ? reject(error) : resolve(port)))
    })
  })
}

async function findExecutable(
  directory: string,
  filename: string,
  platform: NodeJS.Platform = process.platform
): Promise<string> {
  const visit = async (current: string): Promise<string | undefined> => {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const candidate = path.join(current, entry.name)

      if (entry.isDirectory()) {
        const nested = await visit(candidate)

        if (nested) {return nested}
      } else if (entry.name === filename) {
        return candidate
      }
    }

    return undefined
  }

  const found = await visit(directory)

  if (!found) {throw new Error(`${filename} was not present in the verified runtime archive`)}

  if (platform !== 'win32') {await fs.chmod(found, 0o700)}

  return found
}

function chooseRuntimeAsset(catalog: RuntimeCatalog, hardware: HardwareProfile): RuntimeAsset {
  const candidates = catalog.assets.filter(
    asset => asset.platform === hardware.platform && asset.architecture === hardware.architecture
  )

  const directAcceleration = hardware.accelerators.find(value =>
    candidates.some(asset => asset.acceleration === value)
  )

  const acceleration =
    directAcceleration ??
    (hardware.accelerators.some(value => value === 'cuda' || value === 'rocm') &&
    candidates.some(asset => asset.acceleration === 'vulkan')
      ? 'vulkan'
      : undefined)

  const selected = candidates.find(asset => asset.acceleration === acceleration) ?? candidates.find(asset => asset.acceleration === 'cpu')

  if (!selected) {
    throw new Error(`No managed llama.cpp runtime is available for ${hardware.platform}/${hardware.architecture}`)
  }

  return selected
}

function defaultState(): ControllerState {
  return {
    schemaVersion: 1,
    mode: null,
    cloudEscalations: 0,
    tokensAvoided: 0,
    runtimeReportedTokens: 0,
    estimatedTokensAvoided: 0,
    measuredLocalTokens: 0,
    telemetryEnabled: false,
    savingsPeriodStartedAt: new Date().toISOString(),
    attempts: []
  }
}

function isReadinessVerified(state: Pick<ControllerState, 'endpoint' | 'modelId' | 'lastVerifiedAt'>): boolean {
  const verifiedAt = Date.parse(state.lastVerifiedAt ?? '')

  return Boolean(
    state.endpoint &&
    state.modelId &&
    Number.isFinite(verifiedAt) &&
    Date.now() - verifiedAt <= READINESS_TTL_MS
  )
}

function modelIdMatches(catalogId: string, advertisedId: string): boolean {
  const normalize = (value: string) =>
    value
      .toLowerCase()
      .replaceAll('instruct', '')
      .replaceAll('q4-k-m', '')
      .replaceAll('q4_k_m', '')
      .replace(/[^a-z0-9]+/g, '')

  const catalog = normalize(catalogId)
  const advertised = normalize(advertisedId)

  return catalog === advertised || catalog.includes(advertised) || advertised.includes(catalog)
}

function externalModelScore(requestedId: string, advertisedId: string): number {
  const value = advertisedId.toLowerCase()
  let score = modelIdMatches(requestedId, advertisedId) ? 10_000 : 0

  if (/(coder|code|qwen|devstral)/.test(value)) {score += 500}

  if (/(instruct|chat)/.test(value)) {score += 200}

  if (/(vision|embed|rerank)/.test(value)) {score -= 1_000}
  const size = value.match(/(\d+(?:\.\d+)?)b\b/)?.[1]

  if (size) {score += Math.min(100, Number(size))}

  return score
}

export class LocalAiController extends EventEmitter {
  private readonly statePath: string
  private readonly persistence: LocalAiPersistence
  private state: ControllerState = defaultState()
  private sidecar?: ManagedLlamaSidecar
  private operation?: AbortController
  private lastInstall?: { mode: Exclude<LocalAiPolicyMode, 'cloud-only'>; modelId: string }
  private initialized = false
  private readinessConfirmedThisProcess = false
  private activeAttempt?: Pick<LocalAiProgress, 'attemptIndex' | 'attemptTotal' | 'attemptModel' | 'attemptPhase'>

  constructor(private readonly options: LocalAiControllerOptions) {
    super()
    this.statePath = path.join(options.dataRoot, 'controller.json')
    this.persistence = new LocalAiPersistence(options.dataRoot)
  }

  private progress(progress: LocalAiProgress): void {
    const detailed = { ...this.activeAttempt, ...progress }
    this.options.emit?.(detailed)
    this.emit('progress', detailed)
  }

  private handleSidecarState = (snapshot: { state: string }): void => {
    if (snapshot.state !== 'error' && snapshot.state !== 'stopped') {return}
    this.state.lastVerifiedAt = undefined
    void this.save()
  }

  private createSidecar(options: ManagedSidecarOptions): ManagedLlamaSidecar {
    return this.options.createSidecar?.(options) ?? new ManagedLlamaSidecar(options)
  }

  private async initialize(): Promise<void> {
    if (this.initialized) {return}

    try {
      const state = await readJson<ControllerState>(this.statePath)

      if (state.schemaVersion === 1) {this.state = { ...defaultState(), ...state }}
      await fs.chmod(this.statePath, 0o600)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {throw error}
    }

    this.initialized = true
  }

  private async save(): Promise<void> {
    await writeJsonAtomic(this.statePath, this.state)
  }

  private async catalogs(): Promise<{ models: ModelCatalog; runtime: RuntimeCatalog }> {
    let models = validateCatalog(
      await readJson(path.join(this.options.assetsRoot, 'local-ai-model-catalog.v1.json'))
    )

    const updateUrl = process.env.HERMES_LOCAL_AI_CATALOG_URL
    const publicKeyPem = process.env.HERMES_LOCAL_AI_CATALOG_PUBLIC_KEY

    if (updateUrl && publicKeyPem) {
      try {
        models = await fetchVerifiedModelCatalog({
          url: updateUrl,
          publicKeyPem,
          fetchImpl: this.options.fetchImpl
        })
      } catch {
        // A missing, malformed, or unsigned update never replaces the baked catalog.
      }
    }

    const runtime = await readJson<RuntimeCatalog>(
      path.join(this.options.assetsRoot, 'local-ai-runtime-catalog.v1.json')
    )

    if (runtime.schemaVersion !== 1 || runtime.runtime !== 'llama.cpp' || !Array.isArray(runtime.assets)) {
      throw new Error('Unsupported local AI runtime catalog')
    }

    return { models, runtime }
  }

  private async recommendationFor(modelId?: string): Promise<{
    hardware: HardwareProfile
    model: ModelCatalogEntry
    acceleration: string
    availableDisk: number
  }> {
    const [{ models }, hardware, availableDisk] = await Promise.all([
      this.catalogs(),
      this.options.probeHardware?.() ?? probeHardware(),
      this.options.freeDiskBytes?.(this.options.dataRoot) ?? freeDiskBytes(this.options.dataRoot)
    ])

    if (modelId) {
      const model = models.models.find(entry => entry.id === modelId)

      if (!model) {throw new Error(`Unknown local model: ${modelId}`)}

      const selected = selectModel(
        { ...models, models: [model] },
        hardware,
        { capabilities: ['chat', 'tools'], availableDiskBytes: availableDisk }
      )

      if (!selected) {throw new Error(`${model.displayName} does not fit this system's available memory or disk`)}

      return { hardware, model, acceleration: selected.acceleration, availableDisk }
    }

    const selected = selectModel(models, hardware, {
      capabilities: ['chat', 'tools'],
      availableDiskBytes: availableDisk
    })

    if (!selected) {throw new Error('No catalog model fits this system safely')}

    return { hardware, model: selected.model, acceleration: selected.acceleration, availableDisk }
  }

  async getRecommendation() {
    await this.initialize()

    if (this.state.mode === 'cloud-only') {return null}
    const { hardware, model, acceleration } = await this.recommendationFor()

    return {
      modelId: model.id,
      displayName: model.displayName,
      rationale: `${model.displayName} is the highest-ranked verified model that fits ${humanGiB(hardware.memoryBytes)} memory with ${acceleration} acceleration.`,
      acceleration,
      downloadBytes: model.artifact.sizeBytes,
      diskBytes: model.minimumDiskBytes,
      memoryBytes: model.memoryBytes,
      contextTokens: model.contextTokens
    }
  }

  private async refreshLiveReadiness(): Promise<void> {
    if (!this.state.endpoint || !this.state.modelId || !this.state.lastVerifiedAt) {return}

    if (this.state.endpointMode === 'managed' && this.sidecar?.snapshot().state !== 'ready') {
      this.state.lastVerifiedAt = undefined
      await this.save()

      return
    }

    try {
      if (!this.readinessConfirmedThisProcess || !isReadinessVerified(this.state)) {
        await this.verifyAndPersist()

        return
      }

      const response = await (this.options.fetchImpl ?? fetch)(`${this.state.endpoint}/v1/models`, {
        headers: { authorization: `Bearer ${this.state.apiKey ?? 'no-key-required'}` },
        signal: AbortSignal.timeout(2_000)
      })

      if (!response.ok) {throw new Error(`models probe returned ${response.status}`)}
      const payload = (await response.json()) as { data?: Array<{ id?: string }> }

      if (!payload.data?.some(entry => entry.id === this.state.modelId)) {
        throw new Error('verified model is no longer advertised')
      }
    } catch {
      this.state.lastVerifiedAt = undefined
      await this.save()
    }
  }

  async getStatus() {
    await this.initialize()

    if (
      this.state.endpointMode === 'managed' &&
      this.state.modelId &&
      this.state.launchSpec &&
      !this.sidecar
    ) {
      await this.repair()
    }

    await this.refreshLiveReadiness()

    const [available, routed] = await Promise.all([
      this.options.freeDiskBytes?.(this.options.dataRoot) ?? freeDiskBytes(this.options.dataRoot),
      this.readRoutingMetrics()
    ])

    const runtimeSnapshot = this.sidecar?.snapshot()
    const installed = Boolean(this.state.endpoint && this.state.modelId)
    const readinessVerified = isReadinessVerified(this.state)

    const localRuntimeReady =
      readinessVerified &&
      (runtimeSnapshot?.state === 'ready' || this.state.endpointMode === 'existing')

    const cloudFallbacks = this.state.cloudEscalations + routed.cloudEscalations

    return {
      available: true,
      setupRequired:
        this.state.mode === null || (this.state.mode !== 'cloud-only' && !readinessVerified),
      mode: this.state.mode,
      runtime: {
        state: !installed
          ? ('not-installed' as const)
          : localRuntimeReady
            ? ('ready' as const)
            : runtimeSnapshot?.state === 'error'
              ? ('error' as const)
              : ('stopped' as const),
        version: this.state.runtimeVersion,
        endpoint: this.state.endpoint,
        lastVerifiedAt: this.state.lastVerifiedAt,
        error: runtimeSnapshot?.lastError
      },
      model: this.state.modelId
        ? {
            id: this.state.modelId,
            displayName: this.state.modelDisplayName ?? this.state.modelId,
            revision: this.state.modelRevision
          }
        : null,
      routeHealth:
        this.state.mode === 'cloud-only'
          ? ('not-applicable' as const)
          : readinessVerified
            ? ('healthy' as const)
            : ('unavailable' as const),
      routeStatus: {
        label:
          this.state.mode === 'cloud-only'
            ? 'Cloud only'
            : readinessVerified
              ? cloudFallbacks > 0
                ? 'Smart local · cloud fallback used'
                : 'Smart local'
              : 'Local unavailable',
        localReady: readinessVerified,
        cloudFallbacks
      },
      storage: {
        usedBytes: await this.installedBytes(),
        availableBytes: available,
        location: this.options.dataRoot
      },
      cloudEscalations: cloudFallbacks,
      tokensAvoided: this.state.estimatedTokensAvoided + routed.estimatedTokensAvoided,
      estimatedTokensAvoided: this.state.estimatedTokensAvoided + routed.estimatedTokensAvoided,
      measuredLocalTokens: this.state.measuredLocalTokens + routed.measuredLocalTokens,
      tokenMeasurement:
        this.state.estimatedTokensAvoided + routed.estimatedTokensAvoided > 0
          ? ('estimated' as const)
          : ('runtime-reported' as const),
      tokenBaseline: 'same-request-cloud-equivalent',
      tokenSavingsPeriodStartedAt: this.state.savingsPeriodStartedAt,
      telemetryEnabled: this.state.telemetryEnabled,
      attempts: this.state.attempts
    }
  }

  async getInferenceTarget() {
    await this.initialize()
    const verifiedAt = Date.parse(this.state.lastVerifiedAt ?? '')
    const readinessStale = !Number.isFinite(verifiedAt) || Date.now() - verifiedAt > READINESS_TTL_MS

    if (
      this.state.endpointMode === 'managed' &&
      this.state.modelId &&
      this.sidecar?.snapshot().state !== 'ready'
    ) {
      const repaired = await this.repair()

      if (!repaired.ok) {
        return {
          mode: this.state.mode ?? 'cloud-only',
          available: false,
          maxContextTokens: this.state.contextTokens ?? 0
        }
      }
    }

    if (this.state.endpoint && this.state.modelId && readinessStale) {
      const verification = await this.verify()

      if (!verification.ok) {
        return {
          mode: this.state.mode ?? 'cloud-only',
          available: false,
          maxContextTokens: this.state.contextTokens ?? 0
        }
      }
    }

    return {
      mode: this.state.mode ?? 'cloud-only',
      available: isReadinessVerified(this.state),
      endpoint: this.state.endpoint,
      apiKey: this.state.apiKey,
      modelId: this.state.modelId,
      maxContextTokens: this.state.contextTokens ?? 0
    }
  }

  async setMode(mode: unknown) {
    await this.initialize()

    if (mode !== 'local-first' && mode !== 'local-only' && mode !== 'cloud-only') {
      return { ok: false, message: 'Invalid mode' }
    }

    if (mode === 'cloud-only') {
      await this.sidecar?.stop()
    }

    this.state.mode = mode
    await this.save()

    return { ok: true }
  }

  async setTelemetryEnabled(enabled: boolean) {
    await this.initialize()
    this.state.telemetryEnabled = enabled
    await this.save()

    return { ok: true }
  }

  private async compatibleModelCandidates(requestedModelId: string): Promise<ModelCatalogEntry[]> {
    const [{ models }, hardware, availableDiskBytes] = await Promise.all([
      this.catalogs(),
      this.options.probeHardware?.() ?? probeHardware(),
      this.options.freeDiskBytes?.(this.options.dataRoot) ?? freeDiskBytes(this.options.dataRoot)
    ])

    const candidates = models.models.filter(model =>
      Boolean(
        selectModel(
          { ...models, models: [model] },
          hardware,
          { capabilities: ['chat', 'tools'], availableDiskBytes }
        )
      )
    )

    candidates.sort(
      (left, right) =>
        Number(right.id === requestedModelId) - Number(left.id === requestedModelId) ||
        right.qualityRank - left.qualityRank
    )

    return candidates
  }

  async install(input: { mode: Exclude<LocalAiPolicyMode, 'cloud-only'>; modelId: string }) {
    await this.initialize()

    if (this.operation) {return { ok: false, message: 'A local AI operation is already running' }}
    const candidates = await this.compatibleModelCandidates(input.modelId)

    if (!candidates.length) {return { ok: false, message: 'No compatible local model fits this system' }}
    this.state.mode = input.mode
    this.state.lastVerifiedAt = undefined
    this.state.attempts = []
    await this.save()

    const loop = await runCandidateReadinessLoop(
      candidates,
      async ({ candidate, index, total, phase }) => {
        this.activeAttempt = {
          attemptIndex: index,
          attemptTotal: total,
          attemptModel: candidate.displayName,
          attemptPhase: phase
        }

        const attempt: LocalAiInstallAttempt = {
          modelId: candidate.id,
          modelDisplayName: candidate.displayName,
          phase,
          status: 'running',
          startedAt: new Date().toISOString()
        }

        this.state.attempts.push(attempt)
        await this.save()
        this.progress({
          stage: phase === 'runtime-repair' ? 'installing' : 'preparing',
          message:
            phase === 'runtime-repair'
              ? `Repairing the runtime before retrying ${candidate.displayName}…`
              : `Trying ${candidate.displayName}…`
        })

        const result = await this.installCandidate({
          ...input,
          modelId: candidate.id,
          forceManaged: phase === 'runtime-repair'
        })

        attempt.finishedAt = new Date().toISOString()

        if (result.ok) {
          attempt.status = 'verified'
        } else {
          attempt.status = 'failed'
          attempt.reason = result.message || 'Readiness verification failed'
        }

        await this.save()

        if (!result.ok) {await this.sidecar?.stop()}

        if (!result.ok && phase === 'runtime-repair') {
          const modelPath = path.join(this.options.dataRoot, 'models', candidate.artifact.filename)
          await fs.rm(modelPath, { force: true })
          await cleanupPartialDownload(modelPath)
        }

        return {
          ok: result.ok,
          reason: result.message,
          terminal: result.message === 'Local model setup was cancelled.'
        }
      }
    )

    if (loop.ok) {
      this.activeAttempt = undefined

      return { ok: true }
    }

    this.activeAttempt = undefined
    this.state.lastVerifiedAt = undefined
    this.state.endpoint = undefined
    this.state.apiKey = undefined
    await this.save()

    const message = loop.terminal
      ? loop.reason || 'Local model setup was cancelled.'
      : `All compatible local models failed readiness checks. Last failure: ${loop.reason}`

    this.progress({ stage: 'error', message, error: message })

    return { ok: false, message }
  }

  private async installCandidate(input: {
    mode: Exclude<LocalAiPolicyMode, 'cloud-only'>
    modelId: string
    forceManaged?: boolean
  }) {
    await this.initialize()

    if (this.operation) {return { ok: false, message: 'A local AI operation is already running' }}
    this.lastInstall = input
    this.operation = new AbortController()
    const signal = this.operation.signal
    const startedAt = Date.now()

    try {
      this.progress({ stage: 'preparing', message: 'Inspecting hardware and compatible local runtimes…' })
      const { hardware, model, acceleration } = await this.recommendationFor(input.modelId)
      this.state.mode = input.mode

      const candidates = [
        { endpoint: 'http://127.0.0.1:11434', name: 'Ollama' },
        { endpoint: 'http://127.0.0.1:1234', name: 'LM Studio' },
        { endpoint: 'http://127.0.0.1:8080', name: 'llama.cpp' }
      ]

      const existing = await Promise.all(
        candidates.map(async candidate => ({
          ...candidate,
          result: await probeExistingEndpoint(candidate.endpoint, { fetchImpl: this.options.fetchImpl })
        }))
      )

      const rankedExisting = existing
        .flatMap(candidate =>
          candidate.result.ok
            ? (candidate.result.modelIds ?? []).map(advertisedModel => ({
                ...candidate,
                advertisedModel,
                score: externalModelScore(model.id, advertisedModel)
              }))
            : []
        )
        .sort(
          (left, right) =>
            right.score - left.score ||
            left.advertisedModel.localeCompare(right.advertisedModel) ||
            left.endpoint.localeCompare(right.endpoint)
        )

      for (const external of input.forceManaged ? [] : rankedExisting) {
        const verification = await verifyInference({
          endpoint: external.result.endpoint!,
          apiKey: 'no-key-required',
          modelId: external.advertisedModel,
          timeoutMs: 30_000,
          contextProbeTokens: 512,
          fetchImpl: this.options.fetchImpl
        })

        if (!verification.ok) {continue}
        const catalogMatch = modelIdMatches(model.id, external.advertisedModel)

        this.state = {
          ...this.state,
          endpointMode: 'existing',
          endpoint: external.result.endpoint,
          apiKey: 'no-key-required',
          modelId: external.advertisedModel,
          modelDisplayName: catalogMatch ? model.displayName : external.advertisedModel,
          modelRevision: catalogMatch ? model.revision : 'existing-endpoint-verified',
          contextTokens: catalogMatch ? model.contextTokens : 512,
          runtimeVersion: external.name,
          launchSpec: undefined,
          externalModel: catalogMatch
            ? undefined
            : {
                endpointName: external.name,
                advertisedId: external.advertisedModel,
                capabilities: ['chat', 'tools'],
                verifiedContextTokens: 512
              },
          lastVerifiedAt: new Date().toISOString()
        }
        this.readinessConfirmedThisProcess = true
        await this.save()
        this.progress({
          stage: 'complete',
          message: `${this.state.modelDisplayName} is independently verified and ready locally.`
        })

        return { ok: true }
      }

      const { runtime } = await this.catalogs()
      const runtimeAsset = chooseRuntimeAsset(runtime, hardware)
      const modelPath = path.join(this.options.dataRoot, 'models', model.artifact.filename)
      const runtimeArchive = path.join(this.options.dataRoot, 'downloads', path.basename(new URL(runtimeAsset.url).pathname))
      const runtimeDirectory = path.join(this.options.dataRoot, 'runtime', runtime.revision, `${runtimeAsset.platform}-${runtimeAsset.architecture}-${runtimeAsset.acceleration}`)

      let previousBytes = 0
      let previousAt = Date.now()
      let bytesPerSecond = 0

      const reportProgress = (label: string) => (completedBytes: number, totalBytes: number) => {
        const now = Date.now()
        const elapsed = Math.max(1, now - previousAt)
        const instant = ((completedBytes - previousBytes) * 1000) / elapsed
        bytesPerSecond = bytesPerSecond ? bytesPerSecond * 0.75 + instant * 0.25 : instant
        previousBytes = completedBytes
        previousAt = now
        this.progress({
          stage: 'downloading',
          message: label,
          completedBytes,
          totalBytes,
          percent: Math.min(100, (completedBytes / totalBytes) * 100),
          etaSeconds: bytesPerSecond > 0 ? Math.ceil((totalBytes - completedBytes) / bytesPerSecond) : undefined
        })
      }

      await downloadModel(
        {
          url: runtimeAsset.url,
          destinationPath: runtimeArchive,
          sha256: runtimeAsset.sha256,
          sizeBytes: runtimeAsset.sizeBytes
        },
        { signal, onProgress: reportProgress('Downloading verified local runtime…') }
      )
      await downloadModel(
        {
          url: model.artifact.url,
          destinationPath: modelPath,
          sha256: model.artifact.sha256,
          sizeBytes: model.artifact.sizeBytes
        },
        { signal, diskReserveBytes: 2 * GIB, onProgress: reportProgress(`Downloading ${model.displayName}…`) }
      )

      this.progress({ stage: 'installing', message: 'Installing the verified local runtime…' })
      await fs.rm(runtimeDirectory, { recursive: true, force: true })
      await fs.mkdir(runtimeDirectory, { recursive: true })
      await extractRuntimeArchive(runtimeArchive, runtimeDirectory, runtimeAsset.archive)
      const executablePath = await findExecutable(runtimeDirectory, runtimeAsset.executable)
      const port = await reserveLoopbackPort()
      const threads = Math.max(2, hardware.physicalCpuCount ?? Math.floor(hardware.logicalCpuCount / 2))

      const gpuLayers =
        runtimeAsset.acceleration === 'cpu' ||
        (runtimeAsset.acceleration !== 'metal' && !hardware.gpuMemoryBytes)
          ? 0
          : 99

      const extraArgs = ['--alias', model.id, '--jinja', '--n-gpu-layers', String(gpuLayers)]
      this.sidecar = this.createSidecar({
        executablePath,
        modelPath,
        port,
        apiKey: crypto.randomBytes(32).toString('base64url'),
        threads,
        contextTokens: model.contextTokens,
        extraArgs,
        onStateChange: this.handleSidecarState
      })
      this.progress({ stage: 'starting', message: `Starting ${model.displayName} on this device…` })
      const snapshot = this.sidecar.start()
      this.state = {
        ...this.state,
        endpointMode: 'managed',
        endpoint: snapshot.endpoint,
        apiKey: snapshot.apiKey,
        modelId: model.id,
        modelDisplayName: model.displayName,
        modelRevision: model.revision,
        contextTokens: model.contextTokens,
        runtimeVersion: runtime.revision,
        executablePath,
        modelPath,
        externalModel: undefined,
        launchSpec: {
          acceleration: runtimeAsset.acceleration,
          contextTokens: model.contextTokens,
          threads,
          extraArgs
        }
      }
      await this.waitUntilReachable(signal)
      await this.verifyAndPersist()

      if (this.state.telemetryEnabled) {
        await this.persistence.appendTelemetry({
          schemaVersion: LOCAL_AI_SCHEMA_VERSION,
          name: 'load',
          outcome: 'success',
          durationMs: Date.now() - startedAt,
          timestamp: new Date().toISOString(),
          modelId: model.id
        })
      }

      this.progress({ stage: 'complete', message: `${model.displayName} is verified and ready.` })

      return { ok: true }
    } catch (error) {
      const cancelled = signal.aborted || (error as Error).name === 'AbortError'
      const message = cancelled ? 'Local model setup was cancelled.' : error instanceof Error ? error.message : String(error)
      this.progress({
        stage: cancelled ? 'cancelled' : 'error',
        message,
        ...(cancelled ? {} : { error: message })
      })

      return { ok: false, message }
    } finally {
      this.operation = undefined
    }
  }

  private async waitUntilReachable(signal: AbortSignal): Promise<void> {
    const deadline = Date.now() + 120_000

    while (Date.now() < deadline) {
      if (signal.aborted) {throw Object.assign(new Error('Setup cancelled'), { name: 'AbortError' })}

      try {
        const response = await (this.options.fetchImpl ?? fetch)(`${this.state.endpoint}/v1/models`, {
          headers: { authorization: `Bearer ${this.state.apiKey}` },
          signal: AbortSignal.timeout(2000)
        })

        if (response.ok) {return}
      } catch {
        // Model loading can take minutes on CPU-only systems.
      }

      await new Promise(resolve => setTimeout(resolve, 750))
    }

    throw new Error('Local runtime did not become ready within two minutes')
  }

  private async verifyAndPersist(): Promise<void> {
    this.progress({ stage: 'verifying', message: 'Verifying completion and structured tool calling…' })

    const verification = await verifyInference({
      endpoint: this.state.endpoint!,
      apiKey: this.state.apiKey ?? 'no-key-required',
      modelId: this.state.modelId!,
      timeoutMs: 120_000,
      fetchImpl: this.options.fetchImpl
    })

    if (!verification.ok) {throw new Error(verification.reason || 'Local inference verification failed')}
    this.state.lastVerifiedAt = new Date().toISOString()
    this.readinessConfirmedThisProcess = true
    await this.save()
  }

  async cancel() {
    if (!this.operation) {return { ok: true, message: 'No local AI operation is running' }}
    this.operation.abort()

    return { ok: true }
  }

  async retry() {
    if (!this.lastInstall) {return { ok: false, message: 'There is no previous setup to retry' }}

    return this.install(this.lastInstall)
  }

  async verify() {
    await this.initialize()

    try {
      if (!this.state.endpoint || !this.state.modelId) {throw new Error('No local model is installed')}
      await this.verifyAndPersist()

      return { ok: true }
    } catch (error) {
      this.state.lastVerifiedAt = undefined
      await this.save()

      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  }

  async repair() {
    await this.initialize()

    if (this.state.endpointMode === 'existing') {return this.verify()}

    if (!this.state.executablePath || !this.state.modelPath || !this.state.modelId) {
      return this.retry()
    }

    try {
      await this.sidecar?.stop()
      const port = await reserveLoopbackPort()
      const launchSpec = this.state.launchSpec

      if (!launchSpec) {return this.retry()}
      this.sidecar = this.createSidecar({
        executablePath: this.state.executablePath,
        modelPath: this.state.modelPath,
        port,
        apiKey: this.state.apiKey,
        threads: launchSpec.threads,
        contextTokens: launchSpec.contextTokens,
        extraArgs: launchSpec.extraArgs,
        onStateChange: this.handleSidecarState
      })
      const snapshot = this.sidecar.start()
      this.state.endpoint = snapshot.endpoint
      await this.waitUntilReachable(new AbortController().signal)
      await this.verifyAndPersist()

      return { ok: true }
    } catch (error) {
      this.state.lastVerifiedAt = undefined
      await this.save()

      return { ok: false, message: error instanceof Error ? error.message : String(error) }
    }
  }

  async changeModel(modelId?: string) {
    const recommendation = modelId ? await this.recommendationFor(modelId) : await this.recommendationFor()

    return this.install({
      mode: this.state.mode === 'local-only' ? 'local-only' : 'local-first',
      modelId: recommendation.model.id
    })
  }

  async reinstall() {
    if (!this.state.modelId) {return { ok: false, message: 'No local model is selected' }}
    await this.sidecar?.stop()

    if (this.state.modelPath) {
      await fs.rm(this.state.modelPath, { force: true })
      await cleanupPartialDownload(this.state.modelPath)
    }

    return this.install({
      mode: this.state.mode === 'local-only' ? 'local-only' : 'local-first',
      modelId: this.state.modelId
    })
  }

  async uninstall() {
    await this.sidecar?.stop()
    await removeLocalAiInstallation({
      rootDirectory: this.options.dataRoot,
      managedPaths: [
        'models',
        'runtime',
        'downloads',
        'status.json',
        'settings.json',
        'telemetry.jsonl',
        'adaptive-routing.jsonl'
      ]
    })
    this.state = { ...defaultState(), mode: this.state.mode }
    await this.save()

    return { ok: true }
  }

  async shutdown(): Promise<void> {
    await this.sidecar?.stop()
  }

  async recordRoute(input: {
    cloudEscalation?: boolean
    tokensAvoided?: number
    measurement?: 'runtime-reported' | 'estimated'
  }): Promise<void> {
    await this.initialize()

    if (input.cloudEscalation) {this.state.cloudEscalations += 1}

    if (Number.isFinite(input.tokensAvoided)) {
      const tokens = Math.max(0, Math.floor(input.tokensAvoided ?? 0))

      if (input.measurement === 'runtime-reported') {
        this.state.runtimeReportedTokens += tokens
        this.state.measuredLocalTokens += tokens
      } else {
        this.state.tokensAvoided += tokens
        this.state.estimatedTokensAvoided += tokens
      }
    }

    await this.save()
  }

  private async installedBytes(): Promise<number> {
    const visit = async (directory: string): Promise<number> => {
      let total = 0
      let entries

      try {
        entries = await fs.readdir(directory, { withFileTypes: true })
      } catch {
        return 0
      }

      for (const entry of entries) {
        const candidate = path.join(directory, entry.name)
        total += entry.isDirectory() ? await visit(candidate) : (await fs.stat(candidate)).size
      }

      return total
    }

    return visit(this.options.dataRoot)
  }

  private async readRoutingMetrics(): Promise<{
    cloudEscalations: number
    estimatedTokensAvoided: number
    measuredLocalTokens: number
  }> {
    try {
      const raw = await fs.readFile(path.join(this.options.dataRoot, 'adaptive-routing.jsonl'), 'utf8')
      let cloudEscalations = 0
      let estimatedTokensAvoided = 0
      let measuredLocalTokens = 0

      for (const line of raw.split('\n')) {
        if (!line) {continue}

        try {
          const event = JSON.parse(line) as {
            route?: string
            reason?: string
            inputTokens?: number
            outputTokens?: number
            measurement?: string
          }

          if (event.route === 'cloud' && event.reason?.startsWith('local-')) {cloudEscalations += 1}

          if (event.route === 'local') {
            const tokens =
              Math.max(0, Math.floor(event.inputTokens ?? 0)) +
              Math.max(0, Math.floor(event.outputTokens ?? 0))

            if (event.measurement === 'runtime-reported') {
              measuredLocalTokens += tokens
            } else {
              estimatedTokensAvoided += tokens
            }
          }
        } catch {
          // Ignore a partial final line from a concurrently running backend.
        }
      }

      return { cloudEscalations, estimatedTokensAvoided, measuredLocalTokens }
    } catch {
      return { cloudEscalations: 0, estimatedTokensAvoided: 0, measuredLocalTokens: 0 }
    }
  }
}

export const localAiControllerInternals = {
  chooseRuntimeAsset,
  extractRuntimeArchive,
  findExecutable,
  humanGiB,
  isReadinessVerified,
  modelIdMatches,
  reserveLoopbackPort
}
