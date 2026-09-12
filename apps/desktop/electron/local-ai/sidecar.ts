import { type ChildProcessWithoutNullStreams, spawn, type SpawnOptionsWithoutStdio } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import type { EventEmitter } from 'node:events'

import type { LocalAiLifecycleState } from './types'

export interface SidecarProcess extends EventEmitter {
  pid?: number
  exitCode: number | null
  killed: boolean
  kill(signal?: NodeJS.Signals): boolean
}

export type SidecarSpawner = (command: string, args: string[], options: SpawnOptionsWithoutStdio) => SidecarProcess

export interface ManagedSidecarOptions {
  executablePath: string
  modelPath: string
  port: number
  apiKey?: string
  threads?: number
  contextTokens?: number
  extraArgs?: string[]
  environment?: NodeJS.ProcessEnv
  spawnImpl?: SidecarSpawner
  stopTimeoutMs?: number
  onStateChange?: (snapshot: SidecarSnapshot) => void
}

export interface SidecarSnapshot {
  state: LocalAiLifecycleState
  endpoint: string
  apiKey: string
  pid?: number
  lastError?: string
}

function validateOptions(options: ManagedSidecarOptions): void {
  if (!options.executablePath || !options.modelPath) {
    throw new Error('Sidecar executable and model paths are required')
  }

  if (!Number.isSafeInteger(options.port) || options.port < 1 || options.port > 65_535) {
    throw new Error('Sidecar port must be between 1 and 65535')
  }

  if (options.apiKey !== undefined && options.apiKey.length < 16) {
    throw new Error('Sidecar API key must contain at least 16 characters')
  }
}

function defaultSpawner(
  command: string,
  args: string[],
  options: SpawnOptionsWithoutStdio
): ChildProcessWithoutNullStreams {
  return spawn(command, args, { ...options, stdio: 'pipe' })
}

export class ManagedLlamaSidecar {
  readonly endpoint: string
  readonly apiKey: string
  private child?: SidecarProcess
  private lifecycleState: LocalAiLifecycleState = 'stopped'
  private lastError?: string
  private readonly options: ManagedSidecarOptions

  constructor(options: ManagedSidecarOptions) {
    validateOptions(options)
    this.options = options
    this.endpoint = `http://127.0.0.1:${options.port}`
    this.apiKey = options.apiKey ?? randomBytes(32).toString('base64url')
  }

  snapshot(): SidecarSnapshot {
    return {
      state: this.lifecycleState,
      endpoint: this.endpoint,
      apiKey: this.apiKey,
      pid: this.child?.pid,
      lastError: this.lastError
    }
  }

  start(): SidecarSnapshot {
    if (this.child && this.child.exitCode === null) {
      return this.snapshot()
    }
    this.lifecycleState = 'starting'
    this.lastError = undefined

    const args = [
      '--model',
      this.options.modelPath,
      '--host',
      '127.0.0.1',
      '--port',
      String(this.options.port),
      '--api-key',
      this.apiKey
    ]

    if (this.options.threads) {
      args.push('--threads', String(this.options.threads))
    }

    if (this.options.contextTokens) {
      args.push('--ctx-size', String(this.options.contextTokens))
    }
    args.push(...(this.options.extraArgs ?? []))

    try {
      const child = (this.options.spawnImpl ?? defaultSpawner)(this.options.executablePath, args, {
        env: { ...process.env, ...this.options.environment },
        windowsHide: true,
        shell: false
      })

      this.child = child
      child.once('spawn', () => {
        if (this.child === child) {
          this.lifecycleState = 'ready'
          this.options.onStateChange?.(this.snapshot())
        }
      })
      child.once('error', error => {
        if (this.child === child) {
          this.lifecycleState = 'error'
          this.lastError = error instanceof Error ? error.message : String(error)
          this.options.onStateChange?.(this.snapshot())
        }
      })
      child.once('exit', (code, signal) => {
        if (this.child === child) {
          this.child = undefined

          if (this.lifecycleState !== 'stopped') {
            this.lifecycleState = code === 0 ? 'stopped' : 'error'

            if (code !== 0) {
              this.lastError = `Sidecar exited with ${code ?? signal ?? 'unknown status'}`
            }
          }

          this.options.onStateChange?.(this.snapshot())
        }
      })

      return this.snapshot()
    } catch (error) {
      this.lifecycleState = 'error'
      this.lastError = error instanceof Error ? error.message : String(error)
      throw error
    }
  }

  async stop(): Promise<SidecarSnapshot> {
    const child = this.child
    this.lifecycleState = 'stopped'

    if (!child || child.exitCode !== null) {
      this.child = undefined

      return this.snapshot()
    }

    await new Promise<void>(resolve => {
      let settled = false
      let timer: NodeJS.Timeout | undefined

      const finish = () => {
        if (settled) {
          return
        }
        settled = true

        if (timer) {
          clearTimeout(timer)
        }
        resolve()
      }

      child.once('exit', finish)
      child.kill('SIGTERM')

      if (!settled) {
        timer = setTimeout(() => {
          if (child.exitCode === null) {
            child.kill('SIGKILL')
          }
          finish()
        }, this.options.stopTimeoutMs ?? 5000)
      }
    })

    if (this.child === child) {
      this.child = undefined
    }

    return this.snapshot()
  }

  async restart(): Promise<SidecarSnapshot> {
    await this.stop()

    return this.start()
  }
}
