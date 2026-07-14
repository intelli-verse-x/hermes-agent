export interface QuizverseNormalizedResponse {
  contractVersion: string
  data: unknown
  success: boolean
}

export const QUIZVERSE_RESPONSE_CONTRACTS: Readonly<Record<string, {
  version: string
}>>

export function validateAndNormalizeQuizverseResponse(
  tool: string,
  value: unknown,
  context?: {
    payload?: Record<string, unknown>
    rpc?: string
  }
): QuizverseNormalizedResponse
