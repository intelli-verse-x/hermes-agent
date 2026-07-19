import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { LocalAiPersistence } from './persistence'
import { LOCAL_AI_SCHEMA_VERSION, type LocalAiTelemetryEvent } from './types'
import { cleanupLocalAiInstallation, removeLocalAiInstallation, uninstallInternals } from './uninstall'

test('persistence round-trips settings and strips prompt-like telemetry fields', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'local-ai-state-'))
  t.after(() => fs.rm(directory, { recursive: true, force: true }))
  const store = new LocalAiPersistence(directory)
  await store.saveSettings({
    schemaVersion: LOCAL_AI_SCHEMA_VERSION,
    enabled: true,
    endpointMode: 'managed',
    preferredModelId: 'model-a'
  })
  assert.equal((await store.loadSettings()).preferredModelId, 'model-a')

  const unsafeInput = {
    schemaVersion: LOCAL_AI_SCHEMA_VERSION,
    name: 'inference',
    outcome: 'success',
    durationMs: 12,
    timestamp: '2026-01-01T00:00:00.000Z',
    modelId: 'model-a',
    inputTokenCount: 3,
    prompt: 'must never persist',
    response: 'also forbidden'
  } as LocalAiTelemetryEvent

  await store.appendTelemetry(unsafeInput)

  const line = await fs.readFile(store.telemetryPath, 'utf8')
  assert.doesNotMatch(line, /prompt|response|must never persist|also forbidden/)
  assert.deepEqual(JSON.parse(line), {
    schemaVersion: 1,
    name: 'inference',
    outcome: 'success',
    durationMs: 12,
    timestamp: '2026-01-01T00:00:00.000Z',
    modelId: 'model-a',
    inputTokenCount: 3
  })
})

test('uninstall stops the sidecar and removes only requested local AI directories', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'local-ai-uninstall-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const models = path.join(root, 'state', 'models')
  const runtime = path.join(root, 'state', 'runtime')
  await fs.mkdir(models, { recursive: true })
  await fs.mkdir(runtime, { recursive: true })
  await fs.writeFile(path.join(models, 'model.gguf'), 'fixture')
  let stopped = false

  const result = await cleanupLocalAiInstallation({
    directories: [runtime, models, path.join(root, 'state', 'missing')],
    stopSidecar: async () => {
      stopped = true
    }
  })

  assert.equal(stopped, true)
  assert.deepEqual(result.removed, [models, runtime].sort())
  assert.equal(result.missing.length, 1)
  await assert.rejects(fs.stat(models), { code: 'ENOENT' })
  await assert.rejects(fs.stat(runtime), { code: 'ENOENT' })
})

test('uninstall rejects dangerous roots', () => {
  assert.throws(() => uninstallInternals.assertSafeCleanupPath(path.parse(process.cwd()).root), /unsafe/)
  assert.throws(() => uninstallInternals.assertSafeCleanupPath('relative/models'), /absolute/)
})

test('managed uninstall paths cannot escape their root', async t => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'local-ai-managed-cleanup-'))
  const root = path.join(parent, 'runtime-data')
  t.after(() => fs.rm(parent, { recursive: true, force: true }))
  await fs.mkdir(path.join(root, 'models'), { recursive: true })
  await removeLocalAiInstallation({ rootDirectory: root, managedPaths: ['models'] })
  await assert.rejects(fs.stat(path.join(root, 'models')), { code: 'ENOENT' })
  await assert.rejects(
    removeLocalAiInstallation({ rootDirectory: root, managedPaths: ['../outside'] }),
    /escapes root/
  )
})
