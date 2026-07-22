import crypto from 'node:crypto'

import { type ModelCatalog, validateCatalog } from './catalog'

interface SignedCatalogEnvelope {
  payload: unknown
  signature: string
}

export interface SignedCatalogOptions {
  url: string
  publicKeyPem: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }

  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`
  }
  const object = value as Record<string, unknown>

  return `{${Object.keys(object)
    .sort()
    .map(key => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
    .join(',')}}`
}

export async function fetchVerifiedModelCatalog(options: SignedCatalogOptions): Promise<ModelCatalog> {
  const url = new URL(options.url)

  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('Remote catalog URL must use credential-free HTTPS')
  }

  const response = await (options.fetchImpl ?? fetch)(url, {
    redirect: 'error',
    signal: AbortSignal.timeout(options.timeoutMs ?? 5000),
    headers: { accept: 'application/json' }
  })

  if (!response.ok) {
    throw new Error(`Remote catalog returned HTTP ${response.status}`)
  }
  const raw = await response.text()

  if (Buffer.byteLength(raw, 'utf8') > 2 * 1024 * 1024) {
    throw new Error('Remote catalog exceeded size limit')
  }
  const envelope = JSON.parse(raw) as SignedCatalogEnvelope

  if (!envelope || typeof envelope.signature !== 'string' || envelope.payload === undefined) {
    throw new Error('Remote catalog envelope is invalid')
  }

  const verified = crypto.verify(
    null,
    Buffer.from(canonicalJson(envelope.payload)),
    options.publicKeyPem,
    Buffer.from(envelope.signature, 'base64')
  )

  if (!verified) {
    throw new Error('Remote catalog signature verification failed')
  }

  return validateCatalog(envelope.payload)
}

export const signedCatalogInternals = { canonicalJson }
