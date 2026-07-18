#!/usr/bin/env node

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const desktopRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const html = fs.readFileSync(path.join(desktopRoot, 'download-site/index.html'), 'utf8')
const compactHtml = html.replace(/\s+/g, ' ')
const releaseSigners = JSON.parse(fs.readFileSync(path.join(desktopRoot, 'release-signers.json'), 'utf8'))
const brands = ['ix-agency', 'quizverse']

for (const brandId of brands) {
  const signer = releaseSigners?.[brandId]

  if (!signer || typeof signer.appleTeamId !== 'string' || typeof signer.windowsSignerSha256 !== 'string') {
    throw new Error(`Missing release signer policy for ${brandId}`)
  }

  const appleTeamId = signer.appleTeamId.trim().toUpperCase()
  const windowsSignerSha256 = signer.windowsSignerSha256.replace(/\s/g, '').toUpperCase()
  const trustMetadataPublicKeySpki = String(signer.trustMetadataPublicKeySpki || '').replace(/\s/g, '')
  const provenanceRepository = String(signer.provenanceRepository || '')
  const provenanceWorkflow = String(signer.provenanceWorkflow || '')

  if (appleTeamId && !/^[A-Z0-9]{10}$/.test(appleTeamId)) {
    throw new Error(`${brandId} Apple Team ID must be 10 uppercase letters or digits`)
  }
  if (windowsSignerSha256 && !/^[A-F0-9]{64}$/.test(windowsSignerSha256)) {
    throw new Error(`${brandId} Windows signer SHA-256 must be 64 hexadecimal characters`)
  }
  if (trustMetadataPublicKeySpki && !/^[A-Za-z0-9+/]+={0,2}$/.test(trustMetadataPublicKeySpki)) {
    throw new Error(`${brandId} trust metadata public key must be base64 SPKI`)
  }
  if (provenanceRepository !== 'intelli-verse-x/hermes-agent') {
    throw new Error(`${brandId} provenance repository is not approved`)
  }
  if (provenanceWorkflow !== '.github/workflows/desktop-release.yml') {
    throw new Error(`${brandId} provenance workflow is not approved`)
  }

  const key = brandId === 'ix-agency' ? "'ix-agency'" : brandId
  const expected = `${key}: Object.freeze({ appleTeamId: '${appleTeamId}', windowsSignerSha256: '${windowsSignerSha256}', trustMetadataPublicKeySpki: '${trustMetadataPublicKeySpki}', provenanceRepository: '${provenanceRepository}', provenanceWorkflow: '${provenanceWorkflow}' })`

  if (!compactHtml.includes(expected)) {
    throw new Error(`Browser release signer policy is not synchronized for ${brandId}`)
  }
}

if (!html.includes('expectedSignerValid(os, brand.id, trust.verification?.signer)')) {
  throw new Error('Browser trust validation does not enforce the source-controlled signer policy')
}
if (!html.includes('verifyTrustMetadataSignature(trustText, signature, releasePolicy.trustMetadataPublicKeySpki)')) {
  throw new Error('Browser trust validation does not enforce an independently pinned metadata signature')
}
if (!html.includes("PLATFORMS.every(os => results[os]?.version === version && results[os]?.trusted)")) {
  throw new Error('Browser release readiness does not require every platform feed')
}

console.log('[check-release-signers] browser and source-controlled signer policies match')
