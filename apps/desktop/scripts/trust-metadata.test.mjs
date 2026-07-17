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
