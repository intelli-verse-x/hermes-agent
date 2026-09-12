import type { ChildProcess } from 'node:child_process'
import { spawn } from 'node:child_process'
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

export const STUDIO_IPC_CHANNELS = Object.freeze([
  'hermes:studio:status',
  'hermes:studio:choose-external',
  'hermes:studio:install-consent',
  'hermes:studio:launch',
  'hermes:studio:focus',
  'hermes:studio:stop'
] as const)

export interface DesktopStudioStatus {
  state: 'absent' | 'available' | 'running' | 'degraded' | 'stopped'
  mode: 'absent' | 'bring-your-own' | 'managed'
  version: string | null
  executable: string | null
  workspacePath: string | null
  sessionId: string | null
  windowId: string | null
  pid: number | null
  detail: string
}

export interface DesktopStudioLaunch {
  workspacePath: string
  sessionId: string
  windowId: string
}

export class DesktopStudioBroker {
  readonly token = randomBytes(32).toString('base64url')
  readonly endpoint =
    process.platform === 'win32'
      ? `\\\\.\\pipe\\hermes-studio-${randomUUID()}`
      : path.join(
          process.platform === 'darwin' ? '/tmp' : os.tmpdir(),
          `hs-${process.getuid?.() ?? 'user'}-${randomBytes(8).toString('hex')}.sock`
        )
  readonly #seen = new Set<string>()
  #server: net.Server | null = null

  async start(expected: DesktopStudioLaunch): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.#server = net.createServer(socket => {
        let buffer = ''
        let authenticated = false
        socket.setEncoding('utf8')
        socket.on('data', chunk => {
          buffer += chunk

          for (;;) {
            const newline = buffer.indexOf('\n')

            if (newline < 0) {
              break
            }

            const raw = buffer.slice(0, newline)
            buffer = buffer.slice(newline + 1)

            try {
              const request = JSON.parse(raw)
              const requestId = String(request.requestId ?? '')

              if (
                request.protocolVersion !== 1 ||
                !requestId ||
                this.#seen.has(requestId) ||
                Date.now() > Number(request.expiresAt)
              ) {
                throw new Error('Studio broker request expired or replayed')
              }

              this.#seen.add(requestId)
              const localOnly = process.env.HERMES_LOCAL_ONLY === '1'

              const route = {
                route: localOnly ? 'local' : (process.env.HERMES_STUDIO_ROUTE ?? 'offline'),
                localOnly,
                detail: localOnly ? 'Adaptive Local AI; cloud fallback disabled.' : 'Route supplied by Hermes Desktop.'
              }

              const send = (payload: Record<string, unknown>) => {
                socket.write(`${JSON.stringify({ protocolVersion: 1, requestId, payload })}\n`)
              }

              if (!authenticated) {
                const supplied = Buffer.from(String(request.token ?? ''))
                const actual = Buffer.from(this.token)
                const identity = request.payload?.identity

                if (
                  request.payload?.kind !== 'handshake' ||
                  supplied.length !== actual.length ||
                  !timingSafeEqual(supplied, actual) ||
                  identity?.sessionId !== expected.sessionId ||
                  identity?.windowId !== expected.windowId ||
                  path.resolve(identity?.workspaceCanonicalPath ?? '') !== path.resolve(expected.workspacePath)
                ) {
                  throw new Error('Studio broker authentication or identity failed')
                }

                authenticated = true
                send({
                  connected: true,
                  compatible: true,
                  protocolVersion: 1,
                  identity,
                  route,
                  trust: 'restricted',
                  detail: 'Authenticated Hermes Desktop broker connected.'
                })

                continue
              }

              if (request.payload?.kind === 'prompt-submit') {
                if (
                  request.payload.modality === 'voice' &&
                  /^(approve|confirm|yes)$/i.test(String(request.payload.text ?? '').trim())
                ) {
                  send({ kind: 'prompt-event', type: 'error', text: 'Voice cannot approve Hermes actions.' })

                  continue
                }

                send({ kind: 'prompt-event', type: 'accepted', route })

                continue
              }

              if (request.payload?.kind === 'workspace-edit-review') {
                send({
                  kind: 'prompt-event',
                  type: 'error',
                  text: 'Workspace edit review is unavailable while the workspace is restricted.'
                })

                continue
              }

              if (request.payload?.kind === 'health') {
                send({ kind: 'health', state: 'ready', protocolVersion: 1 })

                continue
              }

              throw new Error('Studio broker capability is not allowed')
            } catch (error) {
              socket.destroy(error as Error)
            }
          }
        })
      })
      this.#server.once('error', reject)
      this.#server.listen(this.endpoint, () => {
        if (process.platform !== 'win32') {
          fs.chmodSync(this.endpoint, 0o600)
        }

        resolve()
      })
    })
  }

  stop(): void {
    this.#server?.close()
    this.#server = null

    if (process.platform !== 'win32') {
      fs.rmSync(this.endpoint, { force: true })
    }
  }
}

export class DesktopStudioManager {
  #child: ChildProcess | null = null
  #broker: DesktopStudioBroker | null = null
  #crashes: number[] = []
  #status: DesktopStudioStatus = {
    state: 'absent',
    mode: 'absent',
    version: null,
    executable: null,
    workspacePath: null,
    sessionId: null,
    windowId: null,
    pid: null,
    detail: 'Hermes Studio is optional. Chat remains fully available.'
  }

  status(): DesktopStudioStatus {
    return { ...this.#status }
  }

  useExternal(executable: string): DesktopStudioStatus {
    if (!path.isAbsolute(executable) || !fs.existsSync(executable)) {
      throw new Error('Choose an existing absolute editor executable')
    }

    this.#status = {
      ...this.#status,
      state: 'available',
      mode: 'bring-your-own',
      executable,
      detail: 'Theia-compatible editor configured. It remains separately versioned.'
    }

    return this.status()
  }

  managedInstallConsent(version: string): { consented: true; version: string } {
    if (!/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(version)) {
      throw new Error('Invalid Studio version')
    }

    // Consent is recorded by the future downloader. This foundation never
    // starts a download and therefore cannot surprise first-run users.
    return { consented: true, version }
  }

  async launch(input: DesktopStudioLaunch): Promise<DesktopStudioStatus> {
    if (!this.#status.executable) {
      throw new Error('Install or select a Theia-compatible editor first')
    }

    if (!input.sessionId?.trim() || !input.windowId?.trim()) {
      throw new Error('Session and window linkage are required')
    }

    const workspacePath = path.resolve(input.workspacePath)

    if (!path.isAbsolute(input.workspacePath) || !fs.existsSync(workspacePath)) {
      throw new Error('Workspace must be an existing absolute path')
    }

    if (this.#child && !this.#child.killed) {
      return this.status()
    }

    this.#broker = new DesktopStudioBroker()
    await this.#broker.start({ ...input, workspacePath })

    this.#child = spawn(this.#status.executable, [workspacePath], {
      detached: false,
      env: {
        ...process.env,
        HERMES_STUDIO_SESSION_ID: input.sessionId,
        HERMES_STUDIO_WINDOW_ID: input.windowId,
        HERMES_STUDIO_WORKSPACE: workspacePath,
        HERMES_STUDIO_ENDPOINT: this.#broker.endpoint,
        HERMES_STUDIO_TOKEN: this.#broker.token
      },
      stdio: 'ignore'
    })
    this.#child.once('exit', code => {
      this.#child = null
      this.#broker?.stop()
      this.#broker = null
      const now = Date.now()
      this.#crashes = this.#crashes.filter(at => at > now - 5 * 60_000)

      if (code && code !== 0) {
        this.#crashes.push(now)
      }

      this.#status = {
        ...this.#status,
        state: code && this.#crashes.length > 3 ? 'degraded' : 'stopped',
        pid: null,
        detail:
          code && this.#crashes.length > 3
            ? 'Studio crash budget exhausted. Hermes Desktop remains available.'
            : 'Studio stopped. Hermes Desktop remains available.'
      }
    })
    this.#status = {
      ...this.#status,
      state: 'running',
      workspacePath,
      sessionId: input.sessionId,
      windowId: input.windowId,
      pid: this.#child.pid ?? null,
      detail: 'Studio linked to the exact Hermes workspace and session.'
    }

    return this.status()
  }

  focus(): DesktopStudioStatus {
    if (this.#child?.pid && process.platform !== 'win32') {
      this.#child.kill('SIGUSR1')
    }

    return this.status()
  }

  stop(): DesktopStudioStatus {
    this.#child?.kill('SIGTERM')
    this.#child = null
    this.#broker?.stop()
    this.#broker = null
    this.#status = {
      ...this.#status,
      state: 'stopped',
      pid: null,
      detail: 'Studio stopped. Hermes Desktop remains available.'
    }

    return this.status()
  }
}
