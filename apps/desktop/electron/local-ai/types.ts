export const LOCAL_AI_SCHEMA_VERSION = 1 as const

export type LocalAiCapability = 'chat' | 'completion' | 'tools' | 'embeddings'
export type LocalAiAcceleration = 'cpu' | 'metal' | 'cuda' | 'rocm' | 'vulkan'
export type LocalAiLifecycleState = 'disabled' | 'stopped' | 'starting' | 'ready' | 'error'

export interface HardwareProfile {
  schemaVersion: typeof LOCAL_AI_SCHEMA_VERSION
  platform: NodeJS.Platform
  architecture: NodeJS.Architecture
  logicalCpuCount: number
  physicalCpuCount?: number
  memoryBytes: number
  freeMemoryBytes: number
  /** Stable conservative model budget derived from installed RAM, not a volatile snapshot. */
  usableMemoryBytes?: number
  accelerators: LocalAiAcceleration[]
  gpuMemoryBytes?: number
  gpuMemorySource?: 'adapter-reported' | 'nvidia-smi' | 'unified-memory'
}

export interface LocalAiSettings {
  schemaVersion: typeof LOCAL_AI_SCHEMA_VERSION
  enabled: boolean
  preferredModelId?: string
  endpointMode: 'managed' | 'existing'
  existingEndpoint?: string
  maxContextTokens?: number
}

export interface LocalAiStatus {
  schemaVersion: typeof LOCAL_AI_SCHEMA_VERSION
  state: LocalAiLifecycleState
  modelId?: string
  endpoint?: string
  pid?: number
  lastErrorCode?: string
  updatedAt: string
}

/**
 * Operational telemetry deliberately excludes prompts, responses, tool
 * arguments, and arbitrary metadata.
 */
export interface LocalAiTelemetryEvent {
  schemaVersion: typeof LOCAL_AI_SCHEMA_VERSION
  name: 'download' | 'load' | 'inference' | 'sidecar'
  outcome: 'success' | 'failure' | 'cancelled'
  durationMs: number
  timestamp: string
  modelId?: string
  errorCode?: string
  inputTokenCount?: number
  outputTokenCount?: number
}

export function createDefaultSettings(): LocalAiSettings {
  return {
    schemaVersion: LOCAL_AI_SCHEMA_VERSION,
    enabled: false,
    endpointMode: 'managed'
  }
}
