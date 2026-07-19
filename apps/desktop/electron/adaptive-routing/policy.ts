import type {
  LocalCapabilities,
  LocalOutcome,
  PolicyMode,
  RequestClassification,
  RouteDecision,
  RouteReason
} from './types'

const CLOUD_PROHIBITED_SENSITIVITY = new Set(['confidential', 'restricted'])

function unavailableReason(request: RequestClassification, capabilities: LocalCapabilities): RouteReason | null {
  if (!capabilities.available) {
    return 'local-unavailable'
  }

  if (!capabilities.modalities.includes(request.modality)) {
    return 'unsupported-modality'
  }

  if (request.estimatedContextTokens > capabilities.maxContextTokens) {
    return 'context-limit-exceeded'
  }

  const supportedTools = new Set(capabilities.tools)

  if (request.requiredTools.some(tool => !supportedTools.has(tool))) {
    return 'unsupported-tool'
  }

  return null
}

function cloudOrBlocked(mode: PolicyMode, request: RequestClassification, reason: RouteReason): RouteDecision {
  if (mode === 'local-only' || CLOUD_PROHIBITED_SENSITIVITY.has(request.sensitivity)) {
    return {
      route: 'blocked',
      reason:
        mode !== 'local-only' && CLOUD_PROHIBITED_SENSITIVITY.has(request.sensitivity)
          ? 'sensitive-cloud-blocked'
          : reason
    }
  }

  return { route: 'cloud', reason }
}

export function decideInitialRoute(
  mode: PolicyMode,
  request: RequestClassification,
  capabilities: LocalCapabilities
): RouteDecision {
  if (mode === 'cloud-only') {
    if (CLOUD_PROHIBITED_SENSITIVITY.has(request.sensitivity)) {
      return { route: 'blocked', reason: 'sensitive-cloud-blocked' }
    }

    return { route: 'cloud', reason: 'policy-cloud-only' }
  }

  if (request.explicitFrontier) {
    return cloudOrBlocked(mode, request, 'frontier-requested')
  }

  const reason = unavailableReason(request, capabilities)

  if (reason) {
    return cloudOrBlocked(mode, request, reason)
  }

  return { route: 'local', reason: 'local-capable' }
}

export function evaluateLocalOutcome(mode: PolicyMode, outcome: LocalOutcome): RouteDecision {
  let failure: RouteReason | null = null

  if (outcome.explicitCloudRetry) {
    failure = 'explicit-cloud-retry'
  } else if (!outcome.transportOk) {
    failure = 'local-transport-failure'
  } else if (outcome.malformedToolJson) {
    failure = 'local-malformed-tool-json'
  } else if (outcome.truncated) {
    failure = 'local-truncated'
  } else if (outcome.repeatedToolFailures >= 2) {
    failure = 'local-repeated-tool-failures'
  } else if (!outcome.validationPassed) {
    failure = 'local-validation-failed'
  } else if (outcome.responseText.trim().length === 0) {
    failure = 'local-empty-response'
  } else if (outcome.refused) {
    failure = 'local-refusal'
  }

  if (!failure) {
    return { route: 'local', reason: 'local-quality-passed' }
  }

  if (mode === 'local-only') {
    return { route: 'blocked', reason: failure }
  }

  return { route: 'cloud', reason: failure }
}
