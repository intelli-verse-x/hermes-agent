import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import test from 'node:test'

import { fetchVerifiedModelCatalog, signedCatalogInternals } from './signed-catalog'

const payload = {
  schemaVersion: 1,
  generatedAt: '2026-07-18T00:00:00.000Z',
  models: [
    {
      id: 'fixture',
      displayName: 'Fixture',
      revision: 'immutable',
      capabilities: ['chat'],
      contextTokens: 4096,
      memoryBytes: 1024,
      minimumDiskBytes: 1024,
      accelerations: ['cpu'],
      qualityRank: 1,
      artifact: {
        url: 'https://models.example/fixture.gguf',
        sha256: 'a'.repeat(64),
        sizeBytes: 1024,
        filename: 'fixture.gguf'
      }
    }
  ]
}

test('signed catalog accepts a valid Ed25519 envelope', async () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519')
  const signature = crypto.sign(null, Buffer.from(signedCatalogInternals.canonicalJson(payload)), privateKey)

  const fetchImpl = async () =>
    new Response(JSON.stringify({ payload, signature: signature.toString('base64') }), { status: 200 })

  const catalog = await fetchVerifiedModelCatalog({
    url: 'https://catalog.example/v1.json',
    publicKeyPem: publicKey.export({ format: 'pem', type: 'spki' }).toString(),
    fetchImpl: fetchImpl as typeof fetch
  })

  assert.equal(catalog.models[0].id, 'fixture')
})

test('signed catalog rejects tampering and preserves baked fallback behavior', async () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519')
  const signature = crypto.sign(null, Buffer.from(signedCatalogInternals.canonicalJson(payload)), privateKey)
  const tampered = { ...payload, generatedAt: 'tampered' }

  const fetchImpl = async () =>
    new Response(JSON.stringify({ payload: tampered, signature: signature.toString('base64') }), { status: 200 })

  await assert.rejects(
    fetchVerifiedModelCatalog({
      url: 'https://catalog.example/v1.json',
      publicKeyPem: publicKey.export({ format: 'pem', type: 'spki' }).toString(),
      fetchImpl: fetchImpl as typeof fetch
    }),
    /signature verification failed/
  )
})
