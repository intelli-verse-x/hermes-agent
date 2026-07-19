import type { Route, RouteReason } from './types'

export interface TokenSavingsInput {
  route: Route
  reason: RouteReason
  baselineCloudInputTokens: number
  baselineCloudOutputTokens: number
  actualCloudInputTokens?: number
  actualCloudOutputTokens?: number
  localInputTokens?: number
  localOutputTokens?: number
}

export interface TokenSavingsTelemetry {
  route: Route
  reason: RouteReason
  baselineCloudTokens: number
  actualCloudTokens: number
  localTokens: number
  cloudTokensSaved: number
  savingsRate: number
}

function tokenCount(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return 0
  }

  return Math.max(0, Math.floor(value))
}

/**
 * Produces aggregate numeric telemetry only. The input shape intentionally has
 * no prompt, response, message, or tool-result content fields.
 */
export function calculateTokenSavings(input: TokenSavingsInput): TokenSavingsTelemetry {
  const baselineCloudTokens = tokenCount(input.baselineCloudInputTokens) + tokenCount(input.baselineCloudOutputTokens)

  const actualCloudTokens = tokenCount(input.actualCloudInputTokens) + tokenCount(input.actualCloudOutputTokens)

  const localTokens = tokenCount(input.localInputTokens) + tokenCount(input.localOutputTokens)
  const cloudTokensSaved = Math.max(0, baselineCloudTokens - actualCloudTokens)

  return {
    route: input.route,
    reason: input.reason,
    baselineCloudTokens,
    actualCloudTokens,
    localTokens,
    cloudTokensSaved,
    savingsRate: baselineCloudTokens === 0 ? 0 : cloudTokensSaved / baselineCloudTokens
  }
}
