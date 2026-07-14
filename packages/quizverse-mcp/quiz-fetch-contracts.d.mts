export interface QuizFetchRoute {
  requestVersion: string
  responseAdapter: string
  rpc: string
}

export const QUIZ_FETCH_INPUT_SCHEMA: Readonly<Record<string, unknown>>
export const QUIZ_FETCH_ROUTES: Readonly<Record<string, QuizFetchRoute>>

export function mapQuizFetchRequest(args: Record<string, unknown>): {
  payload: Record<string, unknown>
  rpc: string
}
export function validateQuizFetchRequest(
  value: Record<string, unknown>,
  expectedRpc?: string
): QuizFetchRoute
export function validateQuizFetchBrokerPayload(
  rpc: string | undefined,
  payload: Record<string, unknown>
): string
export function validateAndNormalizeQuizFetchResponse(
  rpc: string | undefined,
  payload: Record<string, unknown>,
  value: unknown
): {
  contractVersion: string
  data: unknown
  success: boolean
}
