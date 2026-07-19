import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { runCandidateReadinessLoop } from './attempt-loop'
import { LocalAiController, localAiControllerInternals } from './controller'
import type { ManagedLlamaSidecar, ManagedSidecarOptions } from './sidecar'

test('candidate verification failure repairs runtime then falls back to next model', async () => {
  const visited: string[] = []

  const result = await runCandidateReadinessLoop(['large', 'small'], async attempt => {
    visited.push(`${attempt.candidate}:${attempt.phase}`)

    return { ok: attempt.candidate === 'small' && attempt.phase === 'candidate', reason: 'verification failed' }
  })

  assert.deepEqual(visited, ['large:candidate', 'large:runtime-repair', 'small:candidate'])
  assert.equal(result.ok, true)
  assert.equal(result.selected, 'small')
})

test('all candidates failed returns recovery reason without false readiness', async () => {
  const result = await runCandidateReadinessLoop(['large', 'small'], async attempt => ({
    ok: false,
    reason: `${attempt.candidate} failed readiness`
  }))

  assert.equal(result.ok, false)
  assert.equal(result.attempts, 4)
  assert.equal(result.reason, 'small failed readiness')
  assert.equal(result.selected, undefined)
})

test('terminal cancellation stops candidate fallback', async () => {
  const result = await runCandidateReadinessLoop(['large', 'small'], async () => ({
    ok: false,
    reason: 'cancelled',
    terminal: true
  }))

  assert.equal(result.ok, false)
  assert.equal(result.attempts, 1)
  assert.equal(result.terminal, true)
})

test('readiness check gates endpoint availability until independent verification', () => {
  assert.equal(
    localAiControllerInternals.isReadinessVerified({
      endpoint: 'http://127.0.0.1:8080',
      modelId: 'model',
      lastVerifiedAt: undefined
    }),
    false
  )
  assert.equal(
    localAiControllerInternals.isReadinessVerified({
      endpoint: 'http://127.0.0.1:8080',
      modelId: 'model',
      lastVerifiedAt: new Date().toISOString()
    }),
    true
  )
  assert.equal(
    localAiControllerInternals.isReadinessVerified({
      endpoint: 'http://127.0.0.1:8080',
      modelId: 'model',
      lastVerifiedAt: '2026-01-01T00:00:00.000Z'
    }),
    false
  )
})

test('a dead existing endpoint clears fresh historical readiness', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'local-ai-dead-endpoint-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  await fs.writeFile(
    path.join(root, 'controller.json'),
    JSON.stringify({
      schemaVersion: 1,
      mode: 'local-first',
      endpointMode: 'existing',
      endpoint: 'http://127.0.0.1:11434',
      modelId: 'verified-model',
      lastVerifiedAt: new Date().toISOString(),
      cloudEscalations: 0,
      tokensAvoided: 0,
      runtimeReportedTokens: 0,
      attempts: []
    })
  )

  const controller = new LocalAiController({
    dataRoot: root,
    assetsRoot: root,
    fetchImpl: async () => new Response('unavailable', { status: 503 })
  })

  const status = await controller.getStatus()

  assert.equal(status.runtime.state, 'stopped')
  assert.equal(status.runtime.lastVerifiedAt, undefined)
  assert.equal(status.routeHealth, 'unavailable')
  if (process.platform !== 'win32') {
    assert.equal((await fs.stat(path.join(root, 'controller.json'))).mode & 0o777, 0o600)
  }
})

test('fresh historical existing readiness is accepted only after full inference reprobe', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'local-ai-stale-endpoint-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  await fs.writeFile(
    path.join(root, 'controller.json'),
    JSON.stringify({
      schemaVersion: 1,
      mode: 'local-first',
      endpointMode: 'existing',
      endpoint: 'http://127.0.0.1:11434',
      modelId: 'verified-model',
      lastVerifiedAt: '2099-01-01T00:00:00.000Z',
      cloudEscalations: 0,
      tokensAvoided: 0,
      runtimeReportedTokens: 0,
      attempts: []
    })
  )
  let inferenceCalls = 0

  const controller = new LocalAiController({
    dataRoot: root,
    assetsRoot: root,
    fetchImpl: async (_input, init) => {
      if (!init?.body) {
        return Response.json({ data: [{ id: 'verified-model' }] })
      }

      inferenceCalls += 1
      const body = JSON.parse(String(init.body))
      const prompt = body.messages?.[0]?.content ?? ''

      if (body.tools) {
        return Response.json({
          choices: [
            {
              message: {
                tool_calls: [
                  {
                    type: 'function',
                    function: { name: 'local_ai_verification', arguments: '{"value":7}' }
                  }
                ]
              }
            }
          ]
        })
      }

      return Response.json({
        choices: [{ message: { content: prompt.includes('readiness ') ? 'CONTEXT_OK' : 'LOCAL_AI_OK' } }]
      })
    }
  })

  const status = await controller.getStatus()

  assert.equal(status.runtime.state, 'ready')
  assert.equal(inferenceCalls, 3)
  assert.notEqual(status.runtime.lastVerifiedAt, '2099-01-01T00:00:00.000Z')
})

test('repair reuses the persisted verified launch specification', async () => {
  const source = await fs.readFile(new URL('./controller.ts', import.meta.url), 'utf8')
  const repair = source.slice(source.indexOf('async repair()'), source.indexOf('async changeModel'))

  assert.match(repair, /const launchSpec = this\.state\.launchSpec/)
  assert.match(repair, /threads: launchSpec\.threads/)
  assert.match(repair, /contextTokens: launchSpec\.contextTokens/)
  assert.match(repair, /extraArgs: launchSpec\.extraArgs/)
  assert.doesNotMatch(repair, /65_536|--n-gpu-layers', '99'/)
})

test('non-catalog adoption ranks candidates and persists verified external capabilities', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'local-ai-external-model-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  let visionInferenceCalls = 0

  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input)

    if (!url.includes(':11434')) {
      return new Response('unavailable', { status: 503 })
    }

    if (!init?.body) {
      return Response.json({ data: [{ id: 'vision-only' }, { id: 'external-coder-7b' }] })
    }

    const body = JSON.parse(String(init.body))

    if (body.model === 'vision-only') {visionInferenceCalls += 1}
    const prompt = body.messages?.[0]?.content ?? ''

    if (body.tools) {
      return Response.json({
        choices: [
          {
            message: {
              tool_calls: [
                {
                  type: 'function',
                  function: { name: 'local_ai_verification', arguments: '{"value":7}' }
                }
              ]
            }
          }
        ]
      })
    }

    return Response.json({
      choices: [{ message: { content: prompt.includes('readiness ') ? 'CONTEXT_OK' : 'LOCAL_AI_OK' } }]
    })
  }

  const controller = new LocalAiController({
    dataRoot: root,
    assetsRoot: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../assets'),
    fetchImpl,
    freeDiskBytes: async () => 100 * 1024 ** 3,
    probeHardware: async () => ({
      schemaVersion: 1,
      platform: process.platform,
      architecture: process.arch,
      logicalCpuCount: 8,
      memoryBytes: 64 * 1024 ** 3,
      freeMemoryBytes: 48 * 1024 ** 3,
      usableMemoryBytes: 48 * 1024 ** 3,
      accelerators: ['cpu']
    })
  })

  await controller.setMode('local-first')
  const recommendation = await controller.getRecommendation()
  const result = await controller.install({ mode: 'local-first', modelId: recommendation.modelId })
  const status = await controller.getStatus()
  const persisted = JSON.parse(await fs.readFile(path.join(root, 'controller.json'), 'utf8'))
  const stateMode = (await fs.stat(path.join(root, 'controller.json'))).mode & 0o777

  assert.equal(result.ok, true)
  assert.equal(status.model?.id, 'external-coder-7b')
  assert.equal(visionInferenceCalls, 0)
  assert.deepEqual(persisted.externalModel.capabilities, ['chat', 'tools'])
  assert.equal(persisted.externalModel.verifiedContextTokens, 512)
  if (process.platform !== 'win32') {assert.equal(stateMode, 0o600)}
})

test('packaged restart rehydrates the exact launch spec and independently reprobes readiness', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'local-ai-rehydrate-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))

  const launchSpec = {
    acceleration: 'cpu',
    contextTokens: 4096,
    threads: 6,
    extraArgs: ['--alias', 'managed-model', '--jinja', '--n-gpu-layers', '0']
  }

  await fs.writeFile(
    path.join(root, 'controller.json'),
    JSON.stringify({
      schemaVersion: 1,
      mode: 'local-first',
      endpointMode: 'managed',
      endpoint: 'http://127.0.0.1:9999',
      apiKey: 'persisted-secret-key',
      modelId: 'managed-model',
      modelDisplayName: 'Managed Model',
      contextTokens: 4096,
      executablePath: '/packaged/llama-server',
      modelPath: '/models/managed.gguf',
      launchSpec,
      lastVerifiedAt: new Date().toISOString(),
      cloudEscalations: 0,
      tokensAvoided: 0,
      runtimeReportedTokens: 0,
      attempts: []
    }),
    { mode: 0o600 }
  )
  let captured: ManagedSidecarOptions | undefined
  let inferenceCalls = 0

  const controller = new LocalAiController({
    dataRoot: root,
    assetsRoot: root,
    createSidecar: options => {
      captured = options

      const snapshot = () => ({
        state: 'ready' as const,
        endpoint: `http://127.0.0.1:${options.port}`,
        apiKey: options.apiKey!,
        pid: 123
      })

      return {
        snapshot,
        start: snapshot,
        stop: async () => ({ ...snapshot(), state: 'stopped' as const })
      } as unknown as ManagedLlamaSidecar
    },
    fetchImpl: async (_input, init) => {
      if (!init?.body) {return Response.json({ data: [{ id: 'managed-model' }] })}
      inferenceCalls += 1
      const body = JSON.parse(String(init.body))
      const prompt = body.messages?.[0]?.content ?? ''

      if (body.tools) {
        return Response.json({
          choices: [
            {
              message: {
                tool_calls: [
                  {
                    type: 'function',
                    function: { name: 'local_ai_verification', arguments: '{"value":7}' }
                  }
                ]
              }
            }
          ]
        })
      }

      return Response.json({
        choices: [{ message: { content: prompt.includes('readiness ') ? 'CONTEXT_OK' : 'LOCAL_AI_OK' } }]
      })
    }
  })

  const status = await controller.getStatus()

  assert.equal(status.runtime.state, 'ready')
  assert.equal(inferenceCalls, 3)
  assert.equal(captured?.apiKey, 'persisted-secret-key')
  assert.equal(captured?.threads, launchSpec.threads)
  assert.equal(captured?.contextTokens, launchSpec.contextTokens)
  assert.deepEqual(captured?.extraArgs, launchSpec.extraArgs)
  if (process.platform !== 'win32') {
    assert.equal((await fs.stat(path.join(root, 'controller.json'))).mode & 0o777, 0o600)
  }
})

test('runtime extraction selects platform-correct tar and ZIP commands', async () => {
  const calls: Array<{ command: string; args: readonly string[] }> = []

  const execute = (async (command: string, args: readonly string[]) => {
    calls.push({ command, args })

    return { stdout: '', stderr: '' }
  }) as never

  await localAiControllerInternals.extractRuntimeArchive(
    '/downloads/runtime.tar.gz',
    '/runtime',
    'tar.gz',
    'linux',
    execute
  )
  await localAiControllerInternals.extractRuntimeArchive(
    'C:\\downloads\\runtime.zip',
    'C:\\runtime',
    'zip',
    'win32',
    execute
  )
  await localAiControllerInternals.extractRuntimeArchive(
    '/downloads/runtime.zip',
    '/runtime',
    'zip',
    'linux',
    execute
  )
  await localAiControllerInternals.extractRuntimeArchive(
    '/downloads/runtime.zip',
    '/runtime',
    'zip',
    'darwin',
    execute
  )

  assert.equal(calls[0].command, 'tar')
  assert.equal(calls[1].command, 'powershell.exe')
  assert.match(calls[1].args.join(' '), /Expand-Archive/)
  assert.equal(calls[2].command, 'unzip')
  assert.equal(calls[3].command, 'unzip')
})

test('runtime executable lookup honors POSIX permissions and Windows names', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'local-ai-runtime-'))
  const nested = path.join(root, 'nested')
  await fs.mkdir(nested)
  await fs.writeFile(path.join(nested, 'llama-server'), 'runtime', { mode: 0o600 })
  await fs.writeFile(path.join(nested, 'llama-server.exe'), 'runtime', { mode: 0o600 })

  const posix = await localAiControllerInternals.findExecutable(root, 'llama-server', 'linux')
  const windows = await localAiControllerInternals.findExecutable(root, 'llama-server.exe', 'win32')

  assert.equal(posix, path.join(nested, 'llama-server'))
  assert.equal(windows, path.join(nested, 'llama-server.exe'))

  if (process.platform !== 'win32') {
    assert.equal((await fs.stat(posix)).mode & 0o777, 0o700)
    assert.equal((await fs.stat(windows)).mode & 0o777, 0o600)
  }
})
