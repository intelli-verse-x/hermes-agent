#!/usr/bin/env node

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import YAML from 'yaml'

import { loadBrand } from './apply-brand.mjs'

export const TRUST_SCHEMA_VERSION = 1

export const PLATFORM_POLICIES = {
  linux: { channelFile: 'latest-linux.yml', method: 'sha512-channel-manifest', signerRequired: false },
  mac: { channelFile: 'latest-mac.yml', method: 'apple-developer-id', signerRequired: true },
  win: { channelFile: 'latest.yml', method: 'windows-authenticode', signerRequired: true }
}

export function sha512Base64(value) {
  return crypto.createHash('sha512').update(value).digest('base64')
}

function required(value, label) {
  if (!String(value || '').trim()) {
    throw new Error(`Missing ${label}`)
  }

  return String(value).trim()
}

export function readChannel(releaseDir, channelFile) {
  const channelPath = path.join(releaseDir, channelFile)
  const text = fs.readFileSync(channelPath, 'utf8')
  const parsed = YAML.parse(text)
  const version = required(parsed?.version, `${channelFile} version`)
  const files = Array.isArray(parsed?.files) ? parsed.files : []

  if (files.length === 0) {
    throw new Error(`${channelFile} lists no artifacts`)
  }

  const artifacts = files.map((entry, index) => {
    const url = required(entry?.url, `${channelFile} files[${index}].url`)
    const expectedSha512 = required(entry?.sha512, `${channelFile} files[${index}].sha512`)
    const expectedSize = Number(entry?.size)

    if (!Number.isSafeInteger(expectedSize) || expectedSize <= 0) {
      throw new Error(`${channelFile} files[${index}].size is invalid`)
    }

    if (path.basename(url) !== url) {
      throw new Error(`${channelFile} artifact URL must be a filename: ${url}`)
    }

    const artifactPath = path.join(releaseDir, url)
    const bytes = fs.readFileSync(artifactPath)
    const size = bytes.byteLength
    const sha512 = sha512Base64(bytes)

    if (size !== expectedSize) {
      throw new Error(`${url} size mismatch: channel=${expectedSize}, artifact=${size}`)
    }

    if (sha512 !== expectedSha512) {
      throw new Error(`${url} SHA-512 does not match ${channelFile}`)
    }

    return { sha512, size, url }
  })

  if (new Set(artifacts.map(artifact => artifact.url)).size !== artifacts.length) {
    throw new Error(`${channelFile} contains duplicate artifact URLs`)
  }

  return { artifacts, sha512: sha512Base64(text), text, version }
}

export function validateTrustMetadata(trust, { brand, channelFile, channelSha512, files, os, version }) {
  if (trust?.schemaVersion !== TRUST_SCHEMA_VERSION) return false
  if (trust?.brand?.id !== brand.id || trust?.brand?.productName !== brand.productName) return false
  if (trust?.brand?.appId !== brand.appId || trust?.platform !== os || trust?.version !== version) return false
  if (trust?.publisher !== brand.author || trust?.verification?.status !== 'verified') return false

  const policy = PLATFORM_POLICIES[os]

  if (!policy || trust.verification.method !== policy.method) return false
  if (policy.signerRequired) {
    if (!trust.verification.signer?.id || !trust.verification.signer?.subject) return false
  } else if (trust.verification.signer !== null) {
    return false
  }

  if (trust?.channel?.file !== channelFile || trust?.channel?.sha512 !== channelSha512) return false
  if (!/^[0-9a-f]{40}$/i.test(trust?.provenance?.releaseCommit || '')) return false
  if (!/^\d+$/.test(String(trust?.provenance?.workflowRunId || ''))) return false
  if (!Array.isArray(trust?.artifacts) || trust.artifacts.length !== files.length) return false

  return files.every((file, index) => {
    const artifact = trust.artifacts[index]

    return artifact?.url === file.url && artifact?.size === file.size && artifact?.sha512 === file.sha512
  })
}

export function generateTrustMetadata({
  brand,
  commit,
  generatedAt = new Date().toISOString(),
  os,
  releaseDir,
  runAttempt,
  runId,
  signer
}) {
  const policy = PLATFORM_POLICIES[os]

  if (!policy) {
    throw new Error(`Unsupported TRUST_OS "${os}"`)
  }

  if (signer?.method !== policy.method) {
    throw new Error(`Signer method "${signer?.method || '<none>'}" does not match ${os} policy "${policy.method}"`)
  }

  if (policy.signerRequired) {
    required(signer?.id, `${os} signer id`)
    required(signer?.subject, `${os} signer subject`)
  } else if (signer?.id != null || signer?.subject != null) {
    throw new Error(`${os} checksum policy must not claim a code-signing identity`)
  }

  const channel = readChannel(releaseDir, policy.channelFile)

  return {
    artifacts: channel.artifacts,
    brand: {
      appId: brand.appId,
      id: brand.id,
      productName: brand.productName
    },
    channel: {
      file: policy.channelFile,
      sha512: channel.sha512
    },
    generatedAt,
    platform: os,
    provenance: {
      releaseCommit: required(commit, 'GITHUB_SHA'),
      workflowRunAttempt: Number(required(runAttempt, 'GITHUB_RUN_ATTEMPT')),
      workflowRunId: required(runId, 'GITHUB_RUN_ID')
    },
    publisher: brand.author,
    schemaVersion: TRUST_SCHEMA_VERSION,
    verification: {
      method: policy.method,
      signer: policy.signerRequired ? { id: signer.id, subject: signer.subject } : null,
      status: 'verified'
    },
    version: channel.version
  }
}

function main() {
  const releaseDir = path.resolve(process.env.RELEASE_DIR || 'release')
  const os = required(process.env.TRUST_OS, 'TRUST_OS')
  const signerPath = path.join(releaseDir, 'trust-signer.json')
  const signer = JSON.parse(fs.readFileSync(signerPath, 'utf8').replace(/^\uFEFF/, ''))
  const trust = generateTrustMetadata({
    brand: loadBrand(),
    commit: process.env.GITHUB_SHA,
    os,
    releaseDir,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT,
    runId: process.env.GITHUB_RUN_ID,
    signer
  })
  const output = path.join(releaseDir, `trust-${os}.json`)

  fs.writeFileSync(output, `${JSON.stringify(trust, null, 2)}\n`, 'utf8')
  console.log(`[trust-metadata] wrote ${output} for ${trust.brand.id} v${trust.version}`)
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isMain) {
  main()
}
