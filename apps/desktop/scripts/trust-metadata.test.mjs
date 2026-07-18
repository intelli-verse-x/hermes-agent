import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { generateTrustMetadata, sha512Base64, validateTrustMetadata } from './trust-metadata.mjs'

const brand = {
  appId: 'ai.intelli-verse-x.ix-agency',
  author: 'Intelliverse X',
  id: 'ix-agency',
  productName: 'IVX Agency'
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
      version: '1.2.3'
    }

    assert.equal(validateTrustMetadata(trust, context), true)
    assert.equal(validateTrustMetadata(trust, { ...context, expectedSignerId: 'B'.repeat(64) }), false)
  } finally {
    fs.rmSync(releaseDir, { force: true, recursive: true })
  }
})
