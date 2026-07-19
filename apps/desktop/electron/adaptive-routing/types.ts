export const POLICY_MODES = ['local-first', 'local-only', 'cloud-only'] as const
export type PolicyMode = (typeof POLICY_MODES)[number]

export const ROUTES = ['local', 'cloud', 'blocked'] as const
export type Route = (typeof ROUTES)[number]

export const ROUTE_REASONS = [
  'policy-cloud-only',
  'local-capable',
  'frontier-requested',
  'unsupported-modality',
  'unsupported-tool',
  'local-unavailable',
  'context-limit-exceeded',
  'sensitive-cloud-blocked',
  'local-quality-passed',
  'local-transport-failure',
  'local-malformed-tool-json',
  'local-truncated',
  'local-repeated-tool-failures',
  'local-validation-failed',
  'local-empty-response',
  'local-refusal',
  'explicit-cloud-retry'
] as const
export type RouteReason = (typeof ROUTE_REASONS)[number]

export type Modality = 'text' | 'image' | 'audio' | 'video'
export type Sensitivity = 'public' | 'internal' | 'confidential' | 'restricted'

export interface RequestClassification {
  modality: Modality
  estimatedContextTokens: number
  requiredTools: readonly string[]
  sensitivity: Sensitivity
  explicitFrontier: boolean
}

export interface LocalCapabilities {
  available: boolean
  modalities: readonly Modality[]
  maxContextTokens: number
  tools: readonly string[]
}

export interface RouteDecision {
  route: Route
  reason: RouteReason
}

export interface LocalOutcome {
  transportOk: boolean
  malformedToolJson: boolean
  truncated: boolean
  repeatedToolFailures: number
  validationPassed: boolean
  responseText: string
  refused: boolean
  explicitCloudRetry: boolean
}
