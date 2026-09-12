import type { HardwareProfile, LocalAiAcceleration, LocalAiCapability } from './types'

export const MODEL_CATALOG_VERSION = 1 as const

export interface ModelArtifact {
  url: string
  sha256: string
  sizeBytes: number
  filename: string
}

export interface ModelCatalogEntry {
  id: string
  displayName: string
  revision: string
  capabilities: LocalAiCapability[]
  contextTokens: number
  memoryBytes: number
  minimumDiskBytes: number
  accelerations: LocalAiAcceleration[]
  qualityRank: number
  artifact: ModelArtifact
}

export interface ModelCatalog {
  schemaVersion: typeof MODEL_CATALOG_VERSION
  generatedAt: string
  models: ModelCatalogEntry[]
}

export interface ModelSelectionRequest {
  capabilities: LocalAiCapability[]
  availableMemoryBytes?: number
  availableDiskBytes: number
  preferredAcceleration?: LocalAiAcceleration
}

export interface ModelSelection {
  model: ModelCatalogEntry
  acceleration: LocalAiAcceleration
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/i

export function validateCatalog(value: unknown): ModelCatalog {
  if (!value || typeof value !== 'object') {
    throw new Error('Model catalog must be an object')
  }
  const catalog = value as Partial<ModelCatalog>

  if (catalog.schemaVersion !== MODEL_CATALOG_VERSION) {
    throw new Error(`Unsupported model catalog version: ${String(catalog.schemaVersion)}`)
  }

  if (!Array.isArray(catalog.models)) {
    throw new Error('Model catalog models must be an array')
  }

  const ids = new Set<string>()

  for (const model of catalog.models) {
    if (!model.id || ids.has(model.id)) {
      throw new Error(`Duplicate or empty model id: ${model.id}`)
    }
    ids.add(model.id)

    if (!Number.isSafeInteger(model.artifact?.sizeBytes) || model.artifact.sizeBytes <= 0) {
      throw new Error(`Invalid artifact size for ${model.id}`)
    }

    if (!SHA256_PATTERN.test(model.artifact.sha256)) {
      throw new Error(`Invalid SHA-256 for ${model.id}`)
    }
    const url = new URL(model.artifact.url)

    if (url.protocol !== 'https:') {
      throw new Error(`Model artifact URL must use HTTPS: ${model.id}`)
    }

    if (model.memoryBytes <= 0 || model.minimumDiskBytes < model.artifact.sizeBytes) {
      throw new Error(`Invalid resource requirements for ${model.id}`)
    }
  }

  return catalog as ModelCatalog
}

function chooseAcceleration(
  model: ModelCatalogEntry,
  hardware: HardwareProfile,
  preferred?: LocalAiAcceleration
): LocalAiAcceleration | undefined {
  const available = new Set(hardware.accelerators)

  const fits = (acceleration: LocalAiAcceleration) =>
    acceleration === 'cpu' || (hardware.gpuMemoryBytes !== undefined && hardware.gpuMemoryBytes >= model.memoryBytes)

  if (preferred && available.has(preferred) && model.accelerations.includes(preferred) && fits(preferred)) {
    return preferred
  }

  return model.accelerations.find(acceleration => available.has(acceleration) && fits(acceleration))
}

export function selectModel(
  catalogValue: unknown,
  hardware: HardwareProfile,
  request: ModelSelectionRequest
): ModelSelection | undefined {
  const catalog = validateCatalog(catalogValue)

  const memoryLimit =
    request.availableMemoryBytes ?? hardware.usableMemoryBytes ?? Math.floor(hardware.memoryBytes * 0.65)

  const required = new Set(request.capabilities)

  const candidates = catalog.models
    .map(model => ({ model, acceleration: chooseAcceleration(model, hardware, request.preferredAcceleration) }))
    .filter(
      (candidate): candidate is ModelSelection =>
        candidate.acceleration !== undefined &&
        candidate.model.memoryBytes <= memoryLimit &&
        candidate.model.minimumDiskBytes <= request.availableDiskBytes &&
        [...required].every(capability => candidate.model.capabilities.includes(capability))
    )

  candidates.sort(
    (left, right) =>
      right.model.qualityRank - left.model.qualityRank ||
      left.model.memoryBytes - right.model.memoryBytes ||
      left.model.id.localeCompare(right.model.id)
  )

  return candidates[0]
}
