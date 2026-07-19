import { createHash, createPublicKey, randomUUID, verify } from 'node:crypto'
import type { ChildProcess } from 'node:child_process'
import path from 'node:path'

import { canonicalWorkspacePath, studioEndpoint, workspaceId } from './protocol.js'

export type StudioInstallMode = 'absent' | 'bring-your-own' | 'managed'
export type StudioState = 'absent' | 'available' | 'installing' | 'running' | 'degraded' | 'stopped'

export interface StudioArtifact {
  platform: 'darwin' | 'linux' | 'win32'
  arch: 'arm64' | 'x64'
  url: string
  sha256: string
  size: number
  format: 'tar.gz' | 'zip'
}

export interface StudioManifest {
  schemaVersion: 1
  product: 'hermes-studio'
  version: string
  publishedAt: string
  artifacts: StudioArtifact[]
  signature: string
  keyId: string
}

export interface StudioStatus {
  state: StudioState
  mode: StudioInstallMode
  version: string | null
  activeVersion: string | null
  workspaceCanonicalPath: string | null
  workspaceId: string | null
  sessionId: string | null
  windowId: string | null
  pid: number | null
  detail: string
}

export interface StudioLaunchInput {
  workspacePath: string
  sessionId: string
  windowId: string
}

export interface StudioPreferences {
  mode: StudioInstallMode
  externalExecutable: string | null
  downloadConsentVersion: string | null
}

export const DEFAULT_STUDIO_PREFERENCES: StudioPreferences = Object.freeze({
  mode: 'absent',
  externalExecutable: null,
  downloadConsentVersion: null
})

export function artifactForRuntime(
  manifest: StudioManifest,
  platform: NodeJS.Platform,
  arch: NodeJS.Architecture
): StudioArtifact {
  const artifact = manifest.artifacts.find(item => item.platform === platform && item.arch === arch)
  if (!artifact) throw new Error(`No Hermes Studio artifact for ${platform}/${arch}`)
  if (!artifact.url.startsWith('https://')) throw new Error('Studio artifacts require HTTPS')
  if (!/^[a-f0-9]{64}$/i.test(artifact.sha256)) throw new Error('Invalid artifact digest')
  return artifact
}

export function assertSafeArchiveEntries(entries: string[]): void {
  for (const entry of entries) {
    const normalized = entry.replaceAll('\\', '/')
    if (
      normalized.startsWith('/') ||
      /^[a-z]:\//i.test(normalized) ||
      normalized.split('/').includes('..') ||
      normalized.includes('\0')
    ) {
      throw new Error(`Unsafe archive entry: ${entry}`)
    }
  }
}

export function verifyArtifact(bytes: Uint8Array, expectedSha256: string): void {
  const actual = createHash('sha256').update(bytes).digest('hex')
  if (actual !== expectedSha256.toLowerCase()) throw new Error('Studio artifact checksum mismatch')
}

export function verifyManifest(manifest: StudioManifest, publicKeyPem: string): void {
  const { signature, ...signed } = manifest
  const canonical = Buffer.from(JSON.stringify(signed))
  const valid = verify(null, canonical, createPublicKey(publicKeyPem), Buffer.from(signature, 'base64'))
  if (!valid) throw new Error('Studio manifest signature invalid')
}

export function requireDownloadConsent(preferences: StudioPreferences, version: string): void {
  if (preferences.mode !== 'managed' || preferences.downloadConsentVersion !== version) {
    throw new Error('Explicit Studio download consent is required')
  }
}

export class CrashBudget {
  readonly #crashes: number[] = []

  constructor(readonly maxRestarts = 3, readonly windowMs = 5 * 60_000, readonly now: () => number = Date.now) {}

  recordCrash(): boolean {
    const current = this.now()
    while (this.#crashes[0] !== undefined && this.#crashes[0] < current - this.windowMs) this.#crashes.shift()
    this.#crashes.push(current)
    return this.#crashes.length <= this.maxRestarts
  }

  reset(): void {
    this.#crashes.length = 0
  }
}

export class StudioProcessSupervisor {
  #child: ChildProcess | null = null
  readonly budget: CrashBudget

  constructor(
    private readonly spawnStudio: (executable: string, args: string[], env: NodeJS.ProcessEnv) => ChildProcess,
    budget = new CrashBudget()
  ) {
    this.budget = budget
  }

  get pid(): number | null {
    return this.#child?.pid ?? null
  }

  launch(executable: string, args: string[], env: NodeJS.ProcessEnv, onCrash: (restartAllowed: boolean) => void): number {
    if (this.#child && !this.#child.killed) return this.#child.pid ?? 0
    this.#child = this.spawnStudio(executable, args, env)
    this.#child.once('exit', code => {
      this.#child = null
      if (code !== 0 && code !== null) onCrash(this.budget.recordCrash())
    })
    return this.#child.pid ?? 0
  }

  focus(): boolean {
    if (!this.#child?.pid) return false
    this.#child.kill('SIGUSR1')
    return true
  }

  stop(): void {
    this.#child?.kill('SIGTERM')
    this.#child = null
  }
}

export class HermesStudioManager {
  #status: StudioStatus = {
    state: 'absent',
    mode: 'absent',
    version: null,
    activeVersion: null,
    workspaceCanonicalPath: null,
    workspaceId: null,
    sessionId: null,
    windowId: null,
    pid: null,
    detail: 'Hermes Studio is optional and has not been configured.'
  }

  constructor(
    private readonly userData: string,
    private readonly supervisor: StudioProcessSupervisor,
    private preferences: StudioPreferences = DEFAULT_STUDIO_PREFERENCES
  ) {}

  status(): StudioStatus {
    return { ...this.#status }
  }

  configureBringYourOwn(executable: string): StudioStatus {
    if (!path.isAbsolute(executable)) throw new Error('Editor executable path must be absolute')
    this.preferences = { mode: 'bring-your-own', externalExecutable: executable, downloadConsentVersion: null }
    this.#status = { ...this.#status, state: 'available', mode: 'bring-your-own', detail: 'External Theia-compatible editor configured.' }
    return this.status()
  }

  consentManagedInstall(version: string): StudioPreferences {
    this.preferences = { mode: 'managed', externalExecutable: null, downloadConsentVersion: version }
    return { ...this.preferences }
  }

  launch(input: StudioLaunchInput, executable: string, version: string): StudioStatus {
    if (!input.sessionId.trim() || !input.windowId.trim()) throw new Error('Exact session and window identity are required')
    const workspaceCanonicalPath = canonicalWorkspacePath(input.workspacePath)
    const launchId = randomUUID()
    const endpoint = studioEndpoint(this.userData, launchId)
    const pid = this.supervisor.launch(
      executable,
      ['--workspace', workspaceCanonicalPath],
      {
        ...process.env,
        HERMES_STUDIO_ENDPOINT: endpoint,
        HERMES_STUDIO_SESSION_ID: input.sessionId,
        HERMES_STUDIO_WINDOW_ID: input.windowId
      },
      restartAllowed => {
        this.#status = {
          ...this.#status,
          state: 'degraded',
          pid: null,
          detail: restartAllowed ? 'Studio crashed; restart is available.' : 'Studio crash budget exhausted; manual recovery required.'
        }
      }
    )
    this.#status = {
      state: 'running',
      mode: this.preferences.mode,
      version,
      activeVersion: version,
      workspaceCanonicalPath,
      workspaceId: workspaceId(workspaceCanonicalPath),
      sessionId: input.sessionId,
      windowId: input.windowId,
      pid,
      detail: 'Hermes Studio is linked to this exact governed session.'
    }
    return this.status()
  }

  stop(): StudioStatus {
    this.supervisor.stop()
    this.#status = { ...this.#status, state: 'stopped', pid: null, detail: 'Studio stopped; Hermes chat remains available.' }
    return this.status()
  }
}
