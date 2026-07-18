import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  generateTrustMetadata,
  sha512Base64,
  signTrustMetadata,
  validateTrustMetadata,
  verifyTrustMetadataSignature
} from './trust-metadata.mjs'

const brand = {
  appId: 'ai.intelli-verse-x.ix-agency',
  author: 'Intelliverse X',
  id: 'ix-agency',
  productName: 'IVX Agency'
}
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 3072,
  privateKeyEncoding: { format: 'pem', type: 'pkcs8' },
  publicKeyEncoding: { format: 'der', type: 'spki' }
})
const releasePolicy = {
  provenanceRepository: 'intelli-verse-x/hermes-agent',
  provenanceWorkflow: '.github/workflows/desktop-release.yml',
  trustMetadataPublicKeySpki: publicKey.toString('base64')
}
const provenance = {
  releasePolicy,
  repository: releasePolicy.provenanceRepository,
  workflowRef: `${releasePolicy.provenanceRepository}/${releasePolicy.provenanceWorkflow}@refs/tags/ix-desktop-v1.2.3`
}

test('generates artifact-exact signer-pinned trust metadata', () => {
  const releaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-trust-'))
  const artifact = Buffer.from('signed installer fixture')
  const url = 'IVX-Agency-1.2.3-mac-arm64.dmg'
  const channelText = [
    'version: 1.2.3',
    'files:',
    `  - url: ${url}`,
    `    sha512: ${sha512Base64(artifact)}`,
    `    size: ${artifact.byteLength}`,
    `path: ${url}`,
    `sha512: ${sha512Base64(artifact)}`,
    "releaseDate: '2026-07-17T00:00:00.000Z'",
    ''
  ].join('\n')

  fs.writeFileSync(path.join(releaseDir, url), artifact)
  fs.writeFileSync(path.join(releaseDir, 'latest-mac.yml'), channelText)

  try {
    const trust = generateTrustMetadata({
      brand,
      commit: '0123456789abcdef0123456789abcdef01234567',
      expectedSignerId: 'TEAMID1234',
      generatedAt: '2026-07-17T00:01:00.000Z',
      os: 'mac',
      ...provenance,
      releaseDir,
      runAttempt: '1',
      runId: '12345',
      signer: {
        id: 'TEAMID1234',
        method: 'apple-developer-id',
        subject: 'Developer ID Application: Intelliverse X (TEAMID1234)'
      }
    })
    const context = {
      brand,
      channelFile: 'latest-mac.yml',
      channelSha512: sha512Base64(channelText),
      expectedSignerId: 'TEAMID1234',
      files: [{ sha512: sha512Base64(artifact), size: artifact.byteLength, url }],
      os: 'mac',
      releasePolicy,
      version: '1.2.3'
    }

    assert.equal(validateTrustMetadata(trust, context), true)
    assert.equal(
      validateTrustMetadata(
        { ...trust, artifacts: [{ ...trust.artifacts[0], size: artifact.byteLength + 1 }] },
        context
      ),
      false
    )
    assert.equal(
      validateTrustMetadata({ ...trust, verification: { ...trust.verification, signer: null } }, context),
      false
    )
    assert.equal(
      validateTrustMetadata(
        {
          ...trust,
          verification: {
            ...trust.verification,
            signer: { ...trust.verification.signer, id: 'OTHERID123' }
          }
        },
        context
      ),
      false
    )
    assert.equal(validateTrustMetadata(trust, { ...context, expectedSignerId: '' }), false)
    assert.throws(
      () =>
        generateTrustMetadata({
          brand,
          commit: '0123456789abcdef0123456789abcdef01234567',
          expectedSignerId: 'OTHERID123',
          os: 'mac',
          ...provenance,
          releaseDir,
          runAttempt: '1',
          runId: '12345',
          signer: {
            id: 'TEAMID1234',
            method: 'apple-developer-id',
            subject: 'Developer ID Application: Intelliverse X (TEAMID1234)'
          }
        }),
      /does not match the source-controlled release policy/
    )
  } finally {
    fs.rmSync(releaseDir, { force: true, recursive: true })
  }
})

test('refuses a signer method that does not match the platform policy', () => {
  assert.throws(
    () =>
      generateTrustMetadata({
        brand,
        commit: '0123456789abcdef0123456789abcdef01234567',
        os: 'mac',
        ...provenance,
        releaseDir: '/unused',
        runAttempt: '1',
        runId: '12345',
        signer: { id: null, method: 'sha512-channel-manifest', subject: null }
      }),
    /does not match mac policy/
  )
})

test('requires the source-controlled Windows certificate SHA-256', () => {
  const releaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-trust-win-'))
  const artifact = Buffer.from('authenticode installer fixture')
  const url = 'IVX-Agency-1.2.3-win-x64.exe'
  const channelText = [
    'version: 1.2.3',
    'files:',
    `  - url: ${url}`,
    `    sha512: ${sha512Base64(artifact)}`,
    `    size: ${artifact.byteLength}`,
    ''
  ].join('\n')
  const expectedSignerId = 'A'.repeat(64)

  fs.writeFileSync(path.join(releaseDir, url), artifact)
  fs.writeFileSync(path.join(releaseDir, 'latest.yml'), channelText)

  try {
    const trust = generateTrustMetadata({
      brand,
      commit: '0123456789abcdef0123456789abcdef01234567',
      expectedSignerId,
      os: 'win',
      ...provenance,
      releaseDir,
      runAttempt: '1',
      runId: '12345',
      signer: {
        id: expectedSignerId,
        method: 'windows-authenticode',
        subject: 'CN=Intelliverse X'
      }
    })
    const context = {
      brand,
      channelFile: 'latest.yml',
      channelSha512: sha512Base64(channelText),
      expectedSignerId,
      files: [{ sha512: sha512Base64(artifact), size: artifact.byteLength, url }],
      os: 'win',
      releasePolicy,
      version: '1.2.3'
    }

    assert.equal(validateTrustMetadata(trust, context), true)
    assert.equal(validateTrustMetadata(trust, { ...context, expectedSignerId: 'B'.repeat(64) }), false)
  } finally {
    fs.rmSync(releaseDir, { force: true, recursive: true })
  }
})

test('requires an independently pinned signature and provenance policy', () => {
  const text = '{"schemaVersion":2}\n'
  const signature = signTrustMetadata(text, privateKey, releasePolicy.trustMetadataPublicKeySpki)

  assert.equal(verifyTrustMetadataSignature(text, signature, releasePolicy.trustMetadataPublicKeySpki), true)
  assert.equal(
    verifyTrustMetadataSignature('{"schemaVersion":2,"tampered":true}\n', signature, releasePolicy.trustMetadataPublicKeySpki),
    false
  )
  assert.equal(verifyTrustMetadataSignature(text, signature, ''), false)
  assert.throws(
    () =>
      generateTrustMetadata({
        brand,
        commit: '0123456789abcdef0123456789abcdef01234567',
        expectedSignerId: 'TEAMID1234',
        os: 'mac',
        ...provenance,
        releaseDir: '/unused',
        repository: 'attacker/example',
        runAttempt: '1',
        runId: '12345',
        signer: {
          id: 'TEAMID1234',
          method: 'apple-developer-id',
          subject: 'Developer ID Application: Intelliverse X (TEAMID1234)'
        }
      }),
    /does not match the source-controlled provenance policy/
  )
})
