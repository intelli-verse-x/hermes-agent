import { productRequest } from './product-client'

export type WordsDatasetKind = 'crossword' | 'daily-solutions' | 'groups' | 'guess-5' | 'imposter' | 'spell-dictionary' | 'spell-puzzles'
export type WordsDatasetSkin = 'general' | 'gre-easy' | 'shared'

export interface WordsContentDataset {
  bytes: number
  etag?: string
  id: string
  kind: WordsDatasetKind
  license: string
  min_items: number
  provenance: string
  sha256: string
  skin: WordsDatasetSkin
  url: string
}

export interface WordsContentManifest {
  cache_max_age_seconds: number
  content_version: string
  datasets: WordsContentDataset[]
  expires_at: string
  generated_at: string
  manifest_version: 1
}

export interface LoadedWordsDataset<T> {
  contentVersion: string
  data: T
  etag: string
  license: string
  minimumItems: number
  offline: boolean
  provenance: string
  source: 'first-party-cache' | 'first-party-network'
}

const inflight = new Map<string, Promise<LoadedWordsDataset<unknown>>>()

function validHex(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value)
}

export function parseWordsContentManifest(value: unknown): WordsContentManifest {
  if (!value || typeof value !== 'object') {throw new Error('Words content manifest is not an object')}
  const raw = value as Record<string, unknown>

  if (
    raw.manifest_version !== 1 ||
    typeof raw.content_version !== 'string' ||
    !/^[A-Za-z0-9._-]{1,80}$/.test(raw.content_version) ||
    typeof raw.generated_at !== 'string' ||
    typeof raw.expires_at !== 'string' ||
    !Number.isInteger(raw.cache_max_age_seconds) ||
    Number(raw.cache_max_age_seconds) < 1 ||
    Number(raw.cache_max_age_seconds) > 86_400 ||
    !Array.isArray(raw.datasets)
  ) {
    throw new Error('Words content manifest metadata is malformed')
  }

  const ids = new Set<string>()
  const generatedAt = Date.parse(raw.generated_at)
  const expiresAt = Date.parse(raw.expires_at)

  if (!Number.isFinite(generatedAt) || !Number.isFinite(expiresAt) || expiresAt <= generatedAt) {
    throw new Error('Words content manifest expiry is malformed')
  }

  const datasets = raw.datasets.map((entry, index) => {
    if (!entry || typeof entry !== 'object') {throw new Error(`Words dataset ${index} is malformed`)}
    const dataset = entry as Record<string, unknown>
    const id = String(dataset.id ?? '')
    const url = String(dataset.url ?? '')
    const kind = String(dataset.kind ?? '') as WordsDatasetKind
    const skin = String(dataset.skin ?? '') as WordsDatasetSkin

    if (
      !/^[A-Za-z0-9._-]{1,100}$/.test(id) ||
      ids.has(id) ||
      !/^\/api\/words\/content\/[A-Za-z0-9._-]+$/.test(url) ||
      !['crossword', 'daily-solutions', 'groups', 'guess-5', 'imposter', 'spell-dictionary', 'spell-puzzles'].includes(kind) ||
      !['general', 'gre-easy', 'shared'].includes(skin) ||
      !validHex(dataset.sha256) ||
      !Number.isInteger(dataset.bytes) ||
      Number(dataset.bytes) < 2 ||
      Number(dataset.bytes) > 32_000_000 ||
      !Number.isInteger(dataset.min_items) ||
      Number(dataset.min_items) < 1 ||
      typeof dataset.license !== 'string' ||
      !dataset.license.trim() ||
      dataset.license.length > 500 ||
      typeof dataset.provenance !== 'string' ||
      !dataset.provenance.trim() ||
      dataset.provenance.length > 500
    ) {
      throw new Error(`Words dataset ${id || index} contract is malformed`)
    }

    ids.add(id)

    return {
      bytes: Number(dataset.bytes),
      etag: typeof dataset.etag === 'string' ? dataset.etag : undefined,
      id,
      kind,
      license: dataset.license.trim(),
      min_items: Number(dataset.min_items),
      provenance: dataset.provenance.trim(),
      sha256: String(dataset.sha256).toLowerCase(),
      skin,
      url
    }
  })

  return {
    cache_max_age_seconds: Number(raw.cache_max_age_seconds),
    content_version: raw.content_version,
    datasets,
    expires_at: raw.expires_at,
    generated_at: raw.generated_at,
    manifest_version: 1
  }
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))

  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

function itemCount(value: unknown): number {
  if (Array.isArray(value)) {return value.length}

  if (value && typeof value === 'object') {
    const root = value as Record<string, unknown>

    if (Array.isArray(root.items)) {return root.items.length}

    if (Array.isArray(root.words)) {return root.words.length}

    if (Array.isArray(root.puzzles)) {return root.puzzles.length}
  }

  return 0
}

async function fetchManifest(cacheMode: 'default' | 'reload' = 'default'): Promise<WordsContentManifest> {
  const response = await productRequest<unknown>({
    cacheMode,
    path: '/api/words/content/manifest'
  })

  const manifest = parseWordsContentManifest(response.data)

  if (Date.parse(manifest.expires_at) <= Date.now()) {
    throw new Error(`Words content manifest expired at ${manifest.expires_at}`)
  }

  return manifest
}

async function fetchAndVerifyDataset<T>(
  dataset: WordsContentDataset,
  cacheMode: 'default' | 'reload' = 'default'
): Promise<{ data: T; etag: string; offline: boolean }> {
  const response = await productRequest<unknown>({ cacheMode, path: dataset.url })
  const raw = typeof response.data === 'string' ? response.data : JSON.stringify(response.data)

  if (new TextEncoder().encode(raw).byteLength !== dataset.bytes) {
    throw new Error(`Words content ${dataset.id} byte length does not match its manifest`)
  }

  if (await sha256(raw) !== dataset.sha256) {
    throw new Error(`Words content ${dataset.id} failed SHA-256 integrity verification`)
  }

  const parsed = typeof response.data === 'string' ? JSON.parse(response.data) as T : response.data as T

  if (itemCount(parsed) < dataset.min_items) {
    throw new Error(`Words content ${dataset.id} is incomplete`)
  }

  return {
    data: parsed,
    etag: response.etag ?? dataset.etag ?? '',
    offline: response.offline === true
  }
}

export async function loadWordsDataset<T>(
  kind: WordsDatasetKind,
  skin: WordsDatasetSkin
): Promise<LoadedWordsDataset<T>> {
  const key = `${kind}:${skin}`
  const active = inflight.get(key)

  if (active) {return active as Promise<LoadedWordsDataset<T>>}

  const request = (async () => {
    let manifest: WordsContentManifest

    try {
      manifest = await fetchManifest()
    } catch (error) {
      if (!/manifest.*(?:malformed|expired)|dataset.*malformed/i.test(error instanceof Error ? error.message : String(error))) {
        throw error
      }

      manifest = await fetchManifest('reload')
    }

    let dataset = manifest.datasets.find(candidate => candidate.kind === kind && (candidate.skin === skin || candidate.skin === 'shared'))

    if (!dataset) {throw new Error(`Words content ${kind}/${skin} is not published in manifest ${manifest.content_version}`)}
    let response: Awaited<ReturnType<typeof fetchAndVerifyDataset<T>>>

    try {
      response = await fetchAndVerifyDataset<T>(dataset)
    } catch (error) {
      if (!/byte length|SHA-256|incomplete|JSON/i.test(error instanceof Error ? error.message : String(error))) {
        throw error
      }

      manifest = await fetchManifest('reload')
      dataset = manifest.datasets.find(candidate => candidate.kind === kind && (candidate.skin === skin || candidate.skin === 'shared'))

      if (!dataset) {throw new Error(`Words content ${kind}/${skin} is not published in manifest ${manifest.content_version}`)}
      response = await fetchAndVerifyDataset<T>(dataset, 'reload')
    }

    return {
      contentVersion: manifest.content_version,
      data: response.data,
      etag: response.etag,
      license: dataset.license,
      minimumItems: dataset.min_items,
      offline: response.offline,
      provenance: dataset.provenance,
      source: response.offline ? 'first-party-cache' : 'first-party-network'
    } satisfies LoadedWordsDataset<T>
  })().finally(() => inflight.delete(key))

  inflight.set(key, request as Promise<LoadedWordsDataset<unknown>>)

  return request
}
