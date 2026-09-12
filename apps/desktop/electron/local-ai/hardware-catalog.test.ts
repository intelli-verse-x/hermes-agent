import assert from 'node:assert/strict'
import test from 'node:test'

import { MODEL_CATALOG_VERSION, type ModelCatalog, selectModel } from './catalog'
import { probeHardware } from './hardware'

test('hardware probe normalizes injected Linux system data', async () => {
  const profile = await probeHardware({
    platform: () => 'linux',
    arch: () => 'x64',
    cpus: () => Array.from({ length: 8 }, () => ({ model: 'Test CPU' })),
    totalmem: () => 16_000,
    freemem: () => 8_000,
    readFile: async file => {
      assert.equal(file, '/proc/cpuinfo')

      return ['physical id : 0\ncore id : 0', 'physical id : 0\ncore id : 1', 'physical id : 0\ncore id : 1'].join(
        '\n\n'
      )
    },
    execFile: async command => {
      assert.equal(command, 'lspci')

      return { stdout: 'NVIDIA Corporation Device with Vulkan' }
    }
  })

  assert.deepEqual(profile.accelerators, ['cuda', 'vulkan', 'cpu'])
  assert.equal(profile.logicalCpuCount, 8)
  assert.equal(profile.physicalCpuCount, 2)
  assert.equal(profile.memoryBytes, 16_000)
  assert.equal(profile.usableMemoryBytes, 10_400)
})

function catalog(): ModelCatalog {
  const artifact = {
    url: 'https://models.example/model.gguf',
    sha256: 'a'.repeat(64),
    sizeBytes: 100,
    filename: 'model.gguf'
  }

  return {
    schemaVersion: MODEL_CATALOG_VERSION,
    generatedAt: '2026-01-01T00:00:00.000Z',
    models: [
      {
        id: 'large',
        displayName: 'Large',
        revision: '1',
        capabilities: ['chat', 'tools'],
        contextTokens: 8192,
        memoryBytes: 900,
        minimumDiskBytes: 100,
        accelerations: ['cuda', 'cpu'],
        qualityRank: 10,
        artifact
      },
      {
        id: 'small',
        displayName: 'Small',
        revision: '1',
        capabilities: ['chat', 'tools'],
        contextTokens: 4096,
        memoryBytes: 400,
        minimumDiskBytes: 100,
        accelerations: ['cpu'],
        qualityRank: 8,
        artifact
      }
    ]
  }
}

test('selection is deterministic by capability and available resources', async () => {
  const hardware = await probeHardware({
    platform: () => 'linux',
    arch: () => 'x64',
    cpus: () => [{ model: 'CPU' }],
    totalmem: () => 1000,
    freemem: () => 500,
    readFile: async () => '',
    execFile: async () => ({ stdout: '' })
  })

  assert.equal(
    selectModel(catalog(), hardware, {
      capabilities: ['chat', 'tools'],
      availableDiskBytes: 1000
    })?.model.id,
    'small'
  )
  assert.equal(
    selectModel(catalog(), hardware, {
      capabilities: ['chat', 'tools'],
      availableMemoryBytes: 1000,
      availableDiskBytes: 1000
    })?.model.id,
    'large'
  )
  assert.equal(
    selectModel(catalog(), hardware, {
      capabilities: ['embeddings'],
      availableDiskBytes: 1000
    }),
    undefined
  )
})

test('Linux GPU memory requires platform evidence and records its source', async () => {
  const profile = await probeHardware({
    platform: () => 'linux',
    arch: () => 'x64',
    cpus: () => [{ model: 'CPU' }],
    totalmem: () => 32 * 1024 ** 3,
    freemem: () => 1,
    readFile: async () => '',
    execFile: async command => ({
      stdout: command === 'nvidia-smi' ? '24576\n' : 'NVIDIA Corporation'
    })
  })

  assert.equal(profile.gpuMemoryBytes, 24_576 * 1024 ** 2)
  assert.equal(profile.gpuMemorySource, 'nvidia-smi')
  assert.equal(profile.usableMemoryBytes, Math.floor(32 * 1024 ** 3 * 0.65))
})
