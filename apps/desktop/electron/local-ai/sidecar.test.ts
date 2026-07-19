import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import test from 'node:test'

import { ManagedLlamaSidecar, type SidecarProcess, type SidecarSpawner } from './sidecar'

class FakeProcess extends EventEmitter implements SidecarProcess {
  pid = 4242
  exitCode: number | null = null
  killed = false
  signals: NodeJS.Signals[] = []

  kill(signal: NodeJS.Signals = 'SIGTERM'): boolean {
    this.killed = true
    this.signals.push(signal)
    this.exitCode = 0
    this.emit('exit', 0, signal)

    return true
  }
}

test('managed sidecar binds llama.cpp to loopback with an API key', async () => {
  const children: FakeProcess[] = []
  const invocations: Array<{ command: string; args: string[]; options: any }> = []

  const spawnImpl: SidecarSpawner = (command, args, options) => {
    const child = new FakeProcess()
    children.push(child)
    invocations.push({ command, args, options })
    queueMicrotask(() => child.emit('spawn'))

    return child
  }

  const sidecar = new ManagedLlamaSidecar({
    executablePath: '/runtime/llama-server',
    modelPath: '/models/model.gguf',
    port: 43123,
    apiKey: '0123456789abcdef',
    threads: 4,
    contextTokens: 4096,
    spawnImpl
  })

  sidecar.start()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(sidecar.snapshot().state, 'ready')
  assert.equal(sidecar.snapshot().endpoint, 'http://127.0.0.1:43123')
  assert.deepEqual(invocations[0]?.args.slice(0, 10), [
    '--model',
    '/models/model.gguf',
    '--host',
    '127.0.0.1',
    '--port',
    '43123',
    '--api-key',
    '0123456789abcdef',
    '--threads',
    '4'
  ])
  assert.equal(invocations[0]?.options.shell, false)

  await sidecar.restart()
  assert.deepEqual(children[0]?.signals, ['SIGTERM'])
  assert.equal(invocations.length, 2)
  await sidecar.stop()
  assert.equal(sidecar.snapshot().state, 'stopped')
})

test('managed sidecar records unexpected process failure', async () => {
  let child: FakeProcess | undefined

  const sidecar = new ManagedLlamaSidecar({
    executablePath: '/runtime/llama-server',
    modelPath: '/models/model.gguf',
    port: 43123,
    apiKey: '0123456789abcdef',
    spawnImpl: () => {
      child = new FakeProcess()

      return child
    }
  })

  sidecar.start()
  child!.exitCode = 9
  child!.emit('exit', 9, null)
  assert.equal(sidecar.snapshot().state, 'error')
  assert.match(sidecar.snapshot().lastError ?? '', /9/)
})
