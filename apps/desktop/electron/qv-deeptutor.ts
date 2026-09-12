/**
 * qv-deeptutor.ts — DeepTutor platform supervisor for the QuizVerse brand.
 *
 * DeepTutor (the IntelliVerseX fork of HKUDS DeepTutor) is the QuizVerse
 * app's learning platform: a FastAPI backend (default :8001) plus a
 * client-heavy Next.js standalone web server (default :3782) whose proxy
 * layer fronts the API and WebSocket streaming. The desktop app does NOT
 * reimplement that UI — it supervises the servers and surfaces the web UI in
 * a webview (see src/app/quizverse/).
 *
 * Two modes, mirroring the Hermes backend spawn pattern in main.ts:
 *
 *  - local (default): spawn the user's DeepTutor install as a child process
 *    (configurable command + working directory), health-poll the web port,
 *    restart on crash with capped backoff, and kill the tree on app quit.
 *  - remote: no child process; point the webview at a hosted DeepTutor
 *    (default https://tutor.intelli-verse-x.ai) and health-probe it.
 *
 * Settings persist in userData/quizverse.json; the optional API key goes
 * through the caller-provided encrypt/decrypt pair (safeStorage in main.ts),
 * same posture as ix-agency.json. This module stays electron-free so the
 * decision logic is unit-testable with `node --test`.
 */
import { type ChildProcess, spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import path from 'node:path'

// ── Settings ────────────────────────────────────────────────────────────────

// User-visible product name for the supervised learning platform (internal code
// and API identity probes keep the upstream "DeepTutor" name).
export const TUTORX_PRODUCT_NAME = 'TutorX'

export interface QuizverseSettings {
  /** 'local' spawns DeepTutor on this machine; 'remote' uses a hosted one. */
  tutorMode: 'local' | 'remote'
  /** Hosted DeepTutor origin (remote mode webview target). */
  remoteUrl: string
  /** Shell command that starts DeepTutor locally (both servers). */
  localCommand: string
  /** Working directory for the local command (a DeepTutor checkout). */
  localDirectory: string
  /** FastAPI backend port the local install binds. 0 = allocate at spawn. */
  apiPort: number
  /** Next.js standalone web port (webview target). 0 = allocate at spawn. */
  webPort: number
  /** Optional API key for hosted TutorX (stored via safeStorage). */
  apiKey: string
  /** LiteLLM OpenAI-compatible base URL injected into local TutorX on spawn. */
  litellmUrl: string
  /** LiteLLM API key for local TutorX (stored via safeStorage). */
  litellmKey: string
  /** Cognito Hosted UI domain used by native account linking. */
  cognitoDomain: string
  /** Public Cognito app client id used by native PKCE. */
  cognitoClientId: string
  /** Cognito user-pool OIDC issuer used for signature discovery. */
  cognitoIssuer: string
}

/** Port sentinel: 0 means "allocate a free port when the servers spawn". */
export const AUTO_PORT = 0

export const DEFAULT_QUIZVERSE_SETTINGS: QuizverseSettings = {
  tutorMode: 'local',
  remoteUrl: 'https://tutor.intelli-verse-x.ai',
  localCommand: 'deeptutor start',
  localDirectory: '',
  apiPort: AUTO_PORT,
  webPort: AUTO_PORT,
  apiKey: '',
  litellmUrl: 'https://litellm.intelli-verse-x.ai',
  litellmKey: '',
  cognitoDomain: '',
  cognitoClientId: '',
  cognitoIssuer: ''
}

/** 0 (auto) and 1–65535 (explicit) are valid; anything else → fallback. */
function clampPort(value: unknown, fallback: number): number {
  const n = Math.round(Number(value))

  return Number.isFinite(n) && n >= 0 && n < 65536 ? n : fallback
}

export function readQuizverseSettings(filePath: string, decryptSecret: (value: unknown) => string): QuizverseSettings {
  let raw

  try {
    raw = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return { ...DEFAULT_QUIZVERSE_SETTINGS }
  }

  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_QUIZVERSE_SETTINGS }
  }

  return {
    tutorMode: raw.tutorMode === 'remote' ? 'remote' : 'local',
    remoteUrl: String(raw.remoteUrl || '').trim() || DEFAULT_QUIZVERSE_SETTINGS.remoteUrl,
    localCommand: String(raw.localCommand || '').trim() || DEFAULT_QUIZVERSE_SETTINGS.localCommand,
    localDirectory: String(raw.localDirectory || '').trim(),
    apiPort: clampPort(raw.apiPort, DEFAULT_QUIZVERSE_SETTINGS.apiPort),
    webPort: clampPort(raw.webPort, DEFAULT_QUIZVERSE_SETTINGS.webPort),
    apiKey: decryptSecret(raw.apiKey) || '',
    litellmUrl: String(raw.litellmUrl || '').trim() || DEFAULT_QUIZVERSE_SETTINGS.litellmUrl,
    litellmKey: decryptSecret(raw.litellmKey) || '',
    cognitoDomain: String(raw.cognitoDomain || '').trim(),
    cognitoClientId: String(raw.cognitoClientId || '').trim(),
    cognitoIssuer: String(raw.cognitoIssuer || '').trim()
  }
}

export function writeQuizverseSettings(
  filePath: string,
  settings: QuizverseSettings,
  // safeStorage envelope ({ encoding, value }) — opaque to this module.
  encryptSecret: (value: string) => unknown
) {
  const payload = {
    tutorMode: settings.tutorMode,
    remoteUrl: settings.remoteUrl,
    localCommand: settings.localCommand,
    localDirectory: settings.localDirectory,
    apiPort: settings.apiPort,
    webPort: settings.webPort,
    apiKey: settings.apiKey ? encryptSecret(settings.apiKey) : null,
    litellmUrl: settings.litellmUrl,
    litellmKey: settings.litellmKey ? encryptSecret(settings.litellmKey) : null,
    cognitoDomain: settings.cognitoDomain,
    cognitoClientId: settings.cognitoClientId,
    cognitoIssuer: settings.cognitoIssuer
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
}

/** Normalize a saved-settings payload from the renderer (partial allowed). */
export function sanitizeQuizverseSettingsInput(input: unknown, current: QuizverseSettings): QuizverseSettings {
  const source = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>

  const pick = (
    key:
      | 'apiKey'
      | 'cognitoClientId'
      | 'cognitoDomain'
      | 'cognitoIssuer'
      | 'litellmKey'
      | 'localCommand'
      | 'localDirectory'
      | 'remoteUrl'
  ): string => (typeof source[key] === 'string' ? String(source[key]).trim() : current[key])

  return {
    tutorMode: source.tutorMode === 'remote' ? 'remote' : source.tutorMode === 'local' ? 'local' : current.tutorMode,
    remoteUrl: pick('remoteUrl') || DEFAULT_QUIZVERSE_SETTINGS.remoteUrl,
    localCommand: pick('localCommand') || DEFAULT_QUIZVERSE_SETTINGS.localCommand,
    localDirectory: pick('localDirectory'),
    apiPort: clampPort(source.apiPort, current.apiPort),
    webPort: clampPort(source.webPort, current.webPort),
    apiKey: pick('apiKey'),
    litellmUrl:
      typeof source.litellmUrl === 'string'
        ? String(source.litellmUrl).trim() || current.litellmUrl
        : current.litellmUrl,
    litellmKey: pick('litellmKey'),
    cognitoDomain: pick('cognitoDomain'),
    cognitoClientId: pick('cognitoClientId'),
    cognitoIssuer: pick('cognitoIssuer')
  }
}

/** What the renderer sees: never the raw API key, just whether one is set. */
export function quizverseSettingsForRenderer(settings: QuizverseSettings) {
  return {
    tutorMode: settings.tutorMode,
    remoteUrl: settings.remoteUrl,
    localCommand: settings.localCommand,
    localDirectory: settings.localDirectory,
    apiPort: settings.apiPort,
    webPort: settings.webPort,
    apiKeySet: Boolean(settings.apiKey),
    litellmUrl: settings.litellmUrl,
    litellmKeySet: Boolean(settings.litellmKey),
    cognitoDomain: settings.cognitoDomain,
    cognitoClientId: settings.cognitoClientId,
    cognitoIssuer: settings.cognitoIssuer
  }
}

// ── URLs + health ───────────────────────────────────────────────────────────

/** The webview target for the current settings. `activeWebPort` is the port
 *  the supervisor actually bound this run (dynamic allocation); '' when the
 *  port is auto and the servers haven't started yet. */
export function deepTutorWebUrl(settings: QuizverseSettings, activeWebPort = 0): string {
  if (settings.tutorMode === 'remote') {
    return settings.remoteUrl.replace(/\/+$/, '')
  }

  const port = activeWebPort || settings.webPort

  return port > 0 ? `http://127.0.0.1:${port}` : ''
}

/** The FastAPI base for the current settings (local mode only; the remote
 *  deployment fronts its API behind the same origin). */
export function deepTutorApiUrl(settings: QuizverseSettings, activeApiPort = 0): string {
  if (settings.tutorMode === 'remote') {
    return settings.remoteUrl.replace(/\/+$/, '')
  }

  const port = activeApiPort || settings.apiPort

  return port > 0 ? `http://127.0.0.1:${port}` : ''
}

/** Ask the OS for a free loopback port (dynamic port mode). */
export function allocateFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()

    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = address && typeof address === 'object' ? address.port : 0

      server.close(() => (port > 0 ? resolve(port) : reject(new Error('no port allocated'))))
    })
  })
}

/** HTTP reachability probe. Any response (including 3xx/4xx) counts as
 *  "listening" — DeepTutor's root may redirect or require auth; a connection
 *  refusal / timeout is the only real "down". */
export function probeHttpReachable(url: string, timeoutMs = 5000): Promise<boolean> {
  return new Promise(resolve => {
    let parsed: URL

    try {
      parsed = new URL(url)
    } catch {
      resolve(false)

      return
    }

    const lib = parsed.protocol === 'https:' ? https : http

    const req = lib.request(parsed, { method: 'GET', timeout: timeoutMs }, res => {
      res.resume()
      resolve(true)
    })

    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', () => resolve(false))
    req.end()
  })
}

/** Identity probe: is the thing on `apiUrl` actually a DeepTutor API?
 *  DeepTutor's FastAPI root (`GET /`, unauthenticated) answers
 *  `{"message": "Welcome to DeepTutor API"}` — we require a JSON body whose
 *  `message` mentions DeepTutor before ADOPTING an already-listening server,
 *  so the supervisor never attaches to some unrelated process that happens
 *  to hold the configured port. */
export function probeDeepTutorApi(apiUrl: string, timeoutMs = 5000): Promise<boolean> {
  return new Promise(resolve => {
    let parsed: URL

    try {
      parsed = new URL(apiUrl)
    } catch {
      resolve(false)

      return
    }

    const lib = parsed.protocol === 'https:' ? https : http

    const req = lib.request(parsed, { method: 'GET', timeout: timeoutMs }, res => {
      let body = ''

      res.setEncoding('utf8')
      res.on('data', chunk => {
        if (body.length < 4096) {
          body += chunk
        }
      })
      res.on('end', () => {
        try {
          const payload = JSON.parse(body)

          resolve(typeof payload?.message === 'string' && /deeptutor/i.test(payload.message))
        } catch {
          resolve(false)
        }
      })
      res.on('error', () => resolve(false))
    })

    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', () => resolve(false))
    req.end()
  })
}

// ── Supervisor ──────────────────────────────────────────────────────────────

export type DeepTutorState = 'error' | 'remote' | 'running' | 'starting' | 'stopped'

export interface DeepTutorStatus {
  state: DeepTutorState
  mode: 'local' | 'remote'
  webUrl: string
  apiUrl: string
  pid: number | null
  detail: string
  /** Last lines of child output — surfaced when startup fails. */
  logTail: string[]
}

const LOG_TAIL_LINES = 80
const HEALTH_POLL_INTERVAL_MS = 1500
const START_TIMEOUT_MS = 120_000
const MAX_AUTO_RESTARTS = 3
const RESTART_BACKOFF_MS = [2_000, 5_000, 15_000]

export interface SupervisorDeps {
  getSettings: () => QuizverseSettings
  log: (line: string) => void
  onStatusChange: (status: DeepTutorStatus) => void
  /** Extra child env (e.g. a PATH with the app's managed Node prepended —
   *  DeepTutor's Next standalone server needs Node 20+ on PATH). */
  extraEnv?: () => Record<string, string | undefined>
}

export function killTutorProcessTree(
  child: Pick<ChildProcess, 'kill' | 'pid'>,
  platform: NodeJS.Platform = process.platform,
  spawnProcess: typeof spawn = spawn
) {
  if (!child.pid) {
    child.kill()

    return
  }

  if (platform === 'win32') {
    const killer = spawnProcess('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
      shell: false,
      stdio: 'ignore',
      windowsHide: true
    })

    killer.on('error', () => child.kill())

    return
  }

  process.kill(-child.pid, 'SIGTERM')
}

/**
 * Lifecycle owner for the local DeepTutor child process. One instance lives
 * in main.ts for the app's lifetime; start/stop are idempotent and the child
 * is detached into its own process group so the whole server tree (FastAPI +
 * Next standalone) can be killed together.
 */
export class DeepTutorSupervisor {
  private child: ChildProcess | null = null
  private state: DeepTutorState = 'stopped'
  private detail = 'Not started'
  private logTail: string[] = []
  private autoRestarts = 0
  private stopping = false
  private startPromise: Promise<DeepTutorStatus> | null = null
  /** Ports actually in use this run (dynamic allocation resolves here). */
  private activePorts: { api: number; web: number } | null = null

  constructor(private deps: SupervisorDeps) {}

  status(): DeepTutorStatus {
    const settings = this.deps.getSettings()
    const mode = settings.tutorMode

    if (mode === 'remote') {
      return {
        state: 'remote',
        mode,
        webUrl: deepTutorWebUrl(settings),
        apiUrl: deepTutorApiUrl(settings),
        pid: null,
        detail: `Hosted ${TUTORX_PRODUCT_NAME} at ${settings.remoteUrl}`,
        logTail: []
      }
    }

    return {
      state: this.state,
      mode,
      webUrl: deepTutorWebUrl(settings, this.activePorts?.web ?? 0),
      apiUrl: deepTutorApiUrl(settings, this.activePorts?.api ?? 0),
      pid: this.child?.pid ?? null,
      detail: this.detail,
      logTail: this.logTail.slice(-12)
    }
  }

  private setState(state: DeepTutorState, detail: string) {
    this.state = state
    this.detail = detail
    this.deps.log(`[deeptutor] ${state}: ${detail}`)
    this.deps.onStatusChange(this.status())
  }

  private appendLog(chunk: string) {
    for (const line of chunk.split(/\r?\n/)) {
      if (line.trim()) {
        this.logTail.push(line)
      }
    }

    if (this.logTail.length > LOG_TAIL_LINES) {
      this.logTail = this.logTail.slice(-LOG_TAIL_LINES)
    }
  }

  /** Start the local servers (no-op in remote mode / when already running). */
  async start(): Promise<DeepTutorStatus> {
    const settings = this.deps.getSettings()

    if (settings.tutorMode === 'remote') {
      return this.status()
    }

    if (this.startPromise) {
      return this.startPromise
    }

    if (this.child && this.state === 'running') {
      return this.status()
    }

    // A server may already be running outside our supervision (dev checkout,
    // docker compose). Only possible with EXPLICIT ports (auto ports are
    // unknowable before spawn), and only adopted after the API answers the
    // DeepTutor identity probe — never attach to a random process that
    // happens to hold the configured port.
    if (settings.webPort > 0 && (await probeHttpReachable(deepTutorWebUrl(settings)))) {
      const apiUrl = deepTutorApiUrl(settings)

      if (settings.apiPort > 0 && (await probeDeepTutorApi(apiUrl))) {
        this.activePorts = { api: settings.apiPort, web: settings.webPort }
        this.setState('running', `Attached to ${TUTORX_PRODUCT_NAME} already listening on :${settings.webPort}`)

        return this.status()
      }

      this.setState(
        'error',
        `Port :${settings.webPort} is already in use, but ${apiUrl || 'the API port'} did not identify as ${TUTORX_PRODUCT_NAME} — ` +
          'free the port, fix the configured ports, or switch them to auto (0)'
      )

      return this.status()
    }

    this.startPromise = this.spawnAndWait(settings).finally(() => {
      this.startPromise = null
    })

    return this.startPromise
  }

  private async spawnAndWait(settings: QuizverseSettings): Promise<DeepTutorStatus> {
    this.stopping = false
    this.logTail = []

    const cwd = settings.localDirectory || undefined
    const executable = configuredTutorExecutable(settings.localCommand)

    if (!cwd || executable === 'deeptutor') {
      this.setState(
        'error',
        `${TUTORX_PRODUCT_NAME} is not provisioned. Install the managed runtime in Setup before starting local learning.`
      )

      return this.status()
    }

    if (path.isAbsolute(executable) && !fs.existsSync(executable)) {
      this.setState('error', `${TUTORX_PRODUCT_NAME} executable not found: ${executable}. Reinstall it from Setup.`)

      return this.status()
    }

    if (!settings.litellmKey) {
      this.setState('error', 'A LiteLLM API key is required for local TutorX. Add it in Setup and test the connection.')

      return this.status()
    }

    if (cwd && !fs.existsSync(cwd)) {
      this.setState('error', `${TUTORX_PRODUCT_NAME} directory not found: ${cwd}`)

      return this.status()
    }

    // Dynamic port mode (the default): ask the OS for free ports at spawn
    // time. Explicit configured ports are respected as-is.
    let apiPort = settings.apiPort
    let webPort = settings.webPort

    try {
      apiPort = apiPort > 0 ? apiPort : await allocateFreePort()
      webPort = webPort > 0 ? webPort : await allocateFreePort()
    } catch (error) {
      this.setState(
        'error',
        `Could not allocate ${TUTORX_PRODUCT_NAME} ports: ${error instanceof Error ? error.message : String(error)}`
      )

      return this.status()
    }

    this.activePorts = { api: apiPort, web: webPort }

    const workspaceDir = cwd

    if (settings.litellmKey && workspaceDir) {
      try {
        injectTutorXLitellmConfig(workspaceDir, settings.litellmUrl, settings.litellmKey)
      } catch (error) {
        this.setState(
          'error',
          `Could not configure LiteLLM for ${TUTORX_PRODUCT_NAME}: ${error instanceof Error ? error.message : String(error)}`
        )

        return this.status()
      }
    }

    this.setState(
      'starting',
      `Starting ${TUTORX_PRODUCT_NAME}: ${settings.localCommand} (api :${apiPort}, web :${webPort})`
    )

    let child: ChildProcess

    try {
      // Through the shell so users can configure anything runnable — a CLI
      // (`deeptutor start`), an npm script, or an activate-then-run one-liner.
      child = spawn(settings.localCommand, {
        shell: true,
        cwd,
        detached: process.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          ...(this.deps.extraEnv?.() ?? {}),
          // BACKEND_PORT / FRONTEND_PORT are DeepTutor's own runtime-settings
          // process overrides (`deeptutor start` honors them); the DEEPTUTOR_*
          // pair + PORT cover custom launcher scripts and a raw Next
          // standalone `node server.js`.
          BACKEND_PORT: String(apiPort),
          FRONTEND_PORT: String(webPort),
          DEEPTUTOR_API_PORT: String(apiPort),
          DEEPTUTOR_WEB_PORT: String(webPort),
          PORT: String(webPort)
        }
      })
    } catch (error) {
      this.setState(
        'error',
        `Failed to spawn ${TUTORX_PRODUCT_NAME}: ${error instanceof Error ? error.message : String(error)}`
      )

      return this.status()
    }

    this.child = child
    child.stdout?.on('data', (data: Buffer) => this.appendLog(data.toString()))
    child.stderr?.on('data', (data: Buffer) => this.appendLog(data.toString()))

    child.on('exit', (code, signal) => {
      if (this.child !== child) {
        return
      }

      this.child = null

      if (this.stopping) {
        this.setState('stopped', `${TUTORX_PRODUCT_NAME} stopped`)

        return
      }

      const why = `${TUTORX_PRODUCT_NAME} exited (${signal || code})`

      // Crash restart with capped backoff — a broken install must not spin.
      if (this.autoRestarts < MAX_AUTO_RESTARTS) {
        const delay = RESTART_BACKOFF_MS[Math.min(this.autoRestarts, RESTART_BACKOFF_MS.length - 1)]

        this.autoRestarts += 1
        this.setState(
          'starting',
          `${why} — restarting in ${Math.round(delay / 1000)}s (${this.autoRestarts}/${MAX_AUTO_RESTARTS})`
        )
        setTimeout(() => {
          if (!this.stopping && !this.child) {
            void this.start()
          }
        }, delay)
      } else {
        this.setState('error', `${why}. Last output:\n${this.logTail.slice(-6).join('\n')}`)
      }
    })

    // Health-poll the web port until it answers or the start window closes.
    const webUrl = deepTutorWebUrl(settings, webPort)
    const apiUrl = deepTutorApiUrl(settings, apiPort)
    const deadline = Date.now() + START_TIMEOUT_MS

    while (Date.now() < deadline) {
      if (!this.child) {
        // exit handler already set the state (error or restarting)
        return this.status()
      }

      if ((await probeHttpReachable(webUrl, 2000)) && (await probeDeepTutorApi(apiUrl, 2000))) {
        this.autoRestarts = 0
        this.setState('running', `${TUTORX_PRODUCT_NAME} ready on :${webPort} (pid ${child.pid})`)

        return this.status()
      }

      await new Promise(resolve => setTimeout(resolve, HEALTH_POLL_INTERVAL_MS))
    }

    this.setState('error', `${TUTORX_PRODUCT_NAME} did not become ready within ${START_TIMEOUT_MS / 1000}s`)
    this.stopChild()

    return this.status()
  }

  private stopChild() {
    const child = this.child

    if (!child) {
      return
    }

    this.child = null

    try {
      killTutorProcessTree(child)
    } catch {
      // Already gone.
    }
  }

  /** Stop the local servers (no-op when nothing is running). */
  stop(): DeepTutorStatus {
    this.stopping = true
    this.autoRestarts = 0

    if (this.child) {
      this.stopChild()
      this.setState('stopped', `${TUTORX_PRODUCT_NAME} stopped`)
    } else if (this.state !== 'stopped') {
      this.setState('stopped', `${TUTORX_PRODUCT_NAME} stopped`)
    }

    this.activePorts = null

    return this.status()
  }

  async restart(): Promise<DeepTutorStatus> {
    this.stop()
    this.stopping = false

    return this.start()
  }

  /** Probe reachability for the current mode (drives the status lamp). */
  async probe(): Promise<boolean> {
    const settings = this.deps.getSettings()
    const apiUrl = deepTutorApiUrl(settings, this.activePorts?.api ?? 0)

    return apiUrl ? probeDeepTutorApi(apiUrl) : false
  }
}

// ── Managed install (provisioning) ──────────────────────────────────────────
// DeepTutor ships on PyPI (`pip install -U deeptutor`) with the Next.js
// standalone web server packaged in — no checkout required. The provisioner
// creates a dedicated venv under the app's userData, installs/upgrades the
// package, and hands back the `deeptutor` entry point so the supervisor's
// localCommand can be pointed at a fully app-managed install. The user's own
// checkout/venv remains supported (any localCommand + localDirectory works).

/** Parse `Python X.Y.Z` from `--version` output. */
export function parsePythonVersion(output: string): [number, number] | null {
  const match = /Python\s+(\d+)\.(\d+)/.exec(String(output || ''))

  return match ? [Number(match[1]), Number(match[2])] : null
}

/** DeepTutor requires Python >= 3.11 (pyproject requires-python). */
export function pythonMeetsFloor(version: [number, number] | null, floor: [number, number] = [3, 11]): boolean {
  return Boolean(version && (version[0] > floor[0] || (version[0] === floor[0] && version[1] >= floor[1])))
}

/** The venv's python / deeptutor entry-point locations per platform. */
export function venvPythonPath(venvDir: string, platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? path.join(venvDir, 'Scripts', 'python.exe') : path.join(venvDir, 'bin', 'python')
}

export function deeptutorBinPath(venvDir: string, platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? path.join(venvDir, 'Scripts', 'deeptutor.exe') : path.join(venvDir, 'bin', 'deeptutor')
}

/** localCommand for a managed install (runs through the shell → quoted). */
export function managedLocalCommand(binPath: string): string {
  return `"${binPath}" start`
}

export function configuredTutorExecutable(command: string): string {
  const trimmed = command.trim()
  const quoted = /^"([^"]+)"/.exec(trimmed)

  return quoted?.[1] ?? trimmed.split(/\s+/, 1)[0] ?? ''
}

interface CommandSpec {
  command: string
  args: string[]
}

function runProvisionCommand(spec: CommandSpec, log: (line: string) => void, env?: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(spec.command, spec.args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: env ?? process.env
    })

    const forward = (data: Buffer) => {
      for (const line of data.toString().split(/\r?\n/)) {
        if (line.trim()) {
          log(line)
        }
      }
    }

    child.stdout?.on('data', forward)
    child.stderr?.on('data', forward)
    child.on('error', reject)
    child.on('exit', code => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`${spec.command} ${spec.args.join(' ')} exited with ${code}`))
      }
    })
  })
}

function captureVersion(spec: CommandSpec): Promise<string | null> {
  return new Promise(resolve => {
    let output = ''

    let child: ChildProcess

    try {
      child = spawn(spec.command, [...spec.args, '--version'], { stdio: ['ignore', 'pipe', 'pipe'] })
    } catch {
      resolve(null)

      return
    }

    // Some interpreters print --version to stderr.
    child.stdout?.on('data', (data: Buffer) => (output += data.toString()))
    child.stderr?.on('data', (data: Buffer) => (output += data.toString()))
    child.on('error', () => resolve(null))
    child.on('exit', code => resolve(code === 0 ? output : null))
  })
}

const PYTHON_CANDIDATES: Record<string, CommandSpec[]> = {
  win32: [
    { command: 'py', args: ['-3'] },
    { command: 'python3', args: [] },
    { command: 'python', args: [] }
  ],
  default: [
    { command: 'python3', args: [] },
    { command: 'python', args: [] }
  ]
}

/** Find a Python >= 3.11 on PATH (candidates overridable for tests). */
export async function findPythonInterpreter(
  candidates: CommandSpec[] = PYTHON_CANDIDATES[process.platform] ?? PYTHON_CANDIDATES.default,
  probe: (spec: CommandSpec) => Promise<string | null> = captureVersion
): Promise<CommandSpec | null> {
  for (const spec of candidates) {
    const output = await probe(spec)

    if (output && pythonMeetsFloor(parsePythonVersion(output))) {
      return spec
    }
  }

  return null
}

export interface ProvisionOptions {
  /** Dedicated venv for the managed install (userData/deeptutor/venv). */
  venvDir: string
  /** TutorX workspace/home — its `data/user/settings` lands here. */
  workspaceDir: string
  log: (line: string) => void
}

const LITELLM_PROFILE_ID = 'qv-litellm'
const LITELLM_MODEL_ID = 'qv-litellm-model'

/** Write LiteLLM as the active LLM provider into TutorX's model_catalog.json. */
export function injectTutorXLitellmConfig(workspaceDir: string, litellmUrl: string, litellmKey: string) {
  const base = String(litellmUrl || '').replace(/\/+$/, '')
  const baseUrl = /\/v1$/.test(base) ? base : `${base}/v1`
  const settingsDir = path.join(workspaceDir, 'data', 'user', 'settings')
  const catalogPath = path.join(settingsDir, 'model_catalog.json')

  fs.mkdirSync(settingsDir, { recursive: true })

  let catalog: Record<string, unknown> = { version: 1, services: {} }

  try {
    const loaded = JSON.parse(fs.readFileSync(catalogPath, 'utf8'))

    if (loaded && typeof loaded === 'object') {
      catalog = loaded as Record<string, unknown>
    }
  } catch {
    // Fresh workspace — start from the default shell.
  }

  const services = (catalog.services as Record<string, unknown>) ?? {}

  services.llm = {
    active_profile_id: LITELLM_PROFILE_ID,
    active_model_id: LITELLM_MODEL_ID,
    profiles: [
      {
        id: LITELLM_PROFILE_ID,
        name: 'QuizVerse LiteLLM',
        binding: 'openai',
        base_url: baseUrl,
        api_key: litellmKey,
        api_version: '',
        extra_headers: {},
        models: [{ id: LITELLM_MODEL_ID, name: 'gpt-4.1', model: 'gpt-4.1' }]
      }
    ]
  }

  catalog.version = 1
  catalog.services = services
  fs.writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8')
}

/** Create/refresh the managed TutorX install. Returns the entry point the
 *  supervisor should run. Throws with a user-presentable message on failure. */
export async function provisionDeepTutor({ venvDir, workspaceDir, log }: ProvisionOptions): Promise<string> {
  const venvPython = venvPythonPath(venvDir)

  if (!fs.existsSync(venvPython)) {
    const python = await findPythonInterpreter()

    if (!python) {
      throw new Error('Python 3.11+ was not found on PATH — install it (python.org or your package manager) and retry')
    }

    log(`Creating ${TUTORX_PRODUCT_NAME} venv at ${venvDir}`)
    fs.mkdirSync(path.dirname(venvDir), { recursive: true })
    await runProvisionCommand({ command: python.command, args: [...python.args, '-m', 'venv', venvDir] }, log)
  }

  log('Installing/upgrading the deeptutor package (this can take a few minutes)…')
  await runProvisionCommand({ command: venvPython, args: ['-m', 'pip', 'install', '--upgrade', 'deeptutor'] }, log)

  const binPath = deeptutorBinPath(venvDir)

  if (!fs.existsSync(binPath)) {
    throw new Error(`Install finished but the deeptutor entry point is missing at ${binPath}`)
  }

  fs.mkdirSync(workspaceDir, { recursive: true })
  log(`${TUTORX_PRODUCT_NAME} ready: ${binPath} (workspace ${workspaceDir})`)

  return binPath
}
