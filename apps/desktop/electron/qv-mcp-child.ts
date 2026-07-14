import { type ChildProcess, execFile, spawn } from 'node:child_process'
import fs from 'node:fs'
import net from 'node:net'

export interface QvMcpChildOptions {
  brokerSecret: string
  brokerSocket: string
  executable: string
  serverPath: string
  serverSocket: string
}

export interface QvMcpStopOptions {
  graceMs?: number
  platform?: NodeJS.Platform
}

export function quizverseMcpKillFallback(platform: NodeJS.Platform): 'SIGKILL' | 'taskkill' {
  return platform === 'win32' ? 'taskkill' : 'SIGKILL'
}

export function isQuizverseMcpChildRunning(child: ChildProcess | null): boolean {
  return Boolean(child && child.exitCode === null && child.signalCode === null)
}

export function buildQuizverseMcpChildEnv(options: QvMcpChildOptions): NodeJS.ProcessEnv {
  return {
    ELECTRON_RUN_AS_NODE: '1',
    QUIZVERSE_MCP_BROKER_SECRET: options.brokerSecret,
    QUIZVERSE_MCP_BROKER_SOCKET: options.brokerSocket,
    QUIZVERSE_MCP_LISTEN_SOCKET: options.serverSocket
  }
}

export function scrubQuizverseMcpSecret(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const clean = { ...env }

  delete clean.QUIZVERSE_MCP_BROKER_SECRET

  return clean
}

export async function startQuizverseMcpChild(options: QvMcpChildOptions): Promise<ChildProcess> {
  if (process.platform !== 'win32') {
    try { fs.unlinkSync(options.serverSocket) } catch { /* no stale socket */ }
  }

  const child = spawn(options.executable, [options.serverPath], {
    env: buildQuizverseMcpChildEnv(options),
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true
  })

  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('QuizVerse MCP child startup timed out')), 10_000)
      let stderr = ''

      const fail = (error: Error) => {
        clearTimeout(timeout)
        reject(error)
      }

      child.once('error', fail)
      child.once('exit', code => fail(new Error(`QuizVerse MCP child exited during startup (${code})`)))
      child.stderr?.setEncoding('utf8')
      child.stderr?.on('data', chunk => {
        stderr += chunk

        if (stderr.includes('QUIZVERSE_MCP_READY')) {
          clearTimeout(timeout)
          child.off('error', fail)
          resolve()
        }
      })
    })
  } catch (error) {
    await stopQuizverseMcpChild(child, options.serverSocket)
    throw error
  }

  return child
}

export async function stopQuizverseMcpChild(
  child: ChildProcess | null,
  serverSocket: string,
  options: QvMcpStopOptions = {}
): Promise<void> {
  const platform = options.platform ?? process.platform
  const graceMs = options.graceMs ?? 750

  if (isQuizverseMcpChildRunning(child)) {
    child.kill('SIGTERM')
    const exited = await waitForExit(child, graceMs)

    if (!exited && child.pid) {
      if (quizverseMcpKillFallback(platform) === 'taskkill') {
        await new Promise<void>(resolve => {
          execFile('taskkill', ['/pid', String(child.pid), '/t', '/f'], () => resolve())
        })
      } else {
        child.kill('SIGKILL')
      }

      await waitForExit(child, graceMs)
    }
  }

  if (platform !== 'win32') {
    try { fs.unlinkSync(serverSocket) } catch { /* already removed */ }
  }
}

export async function probeQuizverseMcp(
  serverSocket: string
): Promise<{ profileText: string; toolIds: string[] }> {
  const socket = net.createConnection(serverSocket)
  socket.setEncoding('utf8')
  let buffer = ''
  let nextId = 1_000_000 + cryptoRandomOffset()
  const waiters = new Map<number, (message: Record<string, any>) => void>()

  socket.on('data', chunk => {
    buffer += chunk
    let newline

    while ((newline = buffer.indexOf('\n')) >= 0) {
      const message = JSON.parse(buffer.slice(0, newline))
      buffer = buffer.slice(newline + 1)
      waiters.get(message.id)?.(message)
      waiters.delete(message.id)
    }
  })
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve)
    socket.once('error', reject)
  })

  const request = (method: string, params?: Record<string, unknown>) =>
    new Promise<Record<string, any>>((resolve, reject) => {
      const id = nextId++

      const timer = setTimeout(() => {
        waiters.delete(id)
        reject(new Error(`QuizVerse MCP probe timed out: ${method}`))
      }, 5_000)

      waiters.set(id, message => {
        clearTimeout(timer)

        if (message.error) {reject(new Error(message.error.message || `QuizVerse MCP probe failed: ${method}`))}
        else {resolve(message.result)}
      })
      socket.write(`${JSON.stringify({ id, jsonrpc: '2.0', method, ...(params ? { params } : {}) })}\n`)
    })

  try {
    await request('initialize', {
      capabilities: {},
      clientInfo: { name: 'quizverse-desktop-health', version: '1.0.0' },
      protocolVersion: '2025-03-26'
    })
    const listed = await request('tools/list')
    const profile = await request('resources/read', { uri: 'qv://player/profile' })
    const profileText = profile.contents?.[0]?.text

    if (typeof profileText !== 'string') {throw new Error('QuizVerse profile resource is unavailable')}

    return {
      profileText,
      toolIds: Array.isArray(listed.tools)
        ? listed.tools.map((tool: { name?: unknown }) => tool.name).filter((name: unknown): name is string => typeof name === 'string')
        : []
    }
  } finally {
    socket.destroy()
  }
}

function cryptoRandomOffset(): number {
  return Math.floor(Math.random() * 900_000)
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (!isQuizverseMcpChildRunning(child)) {return Promise.resolve(true)}

  return new Promise(resolve => {
    const timeout = setTimeout(() => {
      child.off('exit', onExit)
      resolve(false)
    }, timeoutMs)

    const onExit = () => {
      clearTimeout(timeout)
      resolve(true)
    }

    child.once('exit', onExit)
  })
}
