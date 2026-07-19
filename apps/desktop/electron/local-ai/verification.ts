import { normalizeLoopbackEndpoint } from './endpoint-probe'

export interface InferenceVerificationResult {
  ok: boolean
  checks: {
    models: boolean
    completion: boolean
    toolCall: boolean
    latency: boolean
    context: boolean
  }
  latencyMs?: number
  reason?: string
}

export interface InferenceVerificationOptions {
  endpoint: string
  apiKey: string
  modelId: string
  timeoutMs?: number
  maxLatencyMs?: number
  contextProbeTokens?: number
  fetchImpl?: typeof fetch
}

const SENTINEL = 'LOCAL_AI_OK'
const TOOL_NAME = 'local_ai_verification'
const CONTEXT_SENTINEL = 'CONTEXT_OK'

async function requestJson(
  base: URL,
  path: string,
  init: RequestInit,
  options: InferenceVerificationOptions,
  signal: AbortSignal
): Promise<any> {
  const url = new URL(base)
  url.pathname = `${base.pathname.replace(/\/+$/, '')}${path}`

  const response = await (options.fetchImpl ?? fetch)(url, {
    ...init,
    redirect: 'error',
    signal,
    headers: {
      authorization: `Bearer ${options.apiKey}`,
      'content-type': 'application/json',
      ...init.headers
    }
  })

  if (!response.ok) {throw new Error(`${path} returned HTTP ${response.status}`)}

  return response.json()
}

export async function verifyInference(
  options: InferenceVerificationOptions
): Promise<InferenceVerificationResult> {
  const checks = { models: false, completion: false, toolCall: false, latency: false, context: false }
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000)

  try {
    const base = normalizeLoopbackEndpoint(options.endpoint)
    const models = await requestJson(base, '/v1/models', { method: 'GET' }, options, controller.signal)
    checks.models =
      Array.isArray(models?.data) && models.data.some((model: any) => model?.id === options.modelId)

    if (!checks.models) {throw new Error(`Model ${options.modelId} was not advertised`)}

    const completionStartedAt = Date.now()

    const completion = await requestJson(
      base,
      '/v1/chat/completions',
      {
        method: 'POST',
        body: JSON.stringify({
          model: options.modelId,
          temperature: 0,
          seed: 0,
          max_tokens: 16,
          messages: [{ role: 'user', content: `Reply with exactly ${SENTINEL}` }]
        })
      },
      options,
      controller.signal
    )

    checks.completion = completion?.choices?.[0]?.message?.content?.trim() === SENTINEL
    const latencyMs = Date.now() - completionStartedAt
    checks.latency = latencyMs <= (options.maxLatencyMs ?? 30_000)

    if (!checks.completion) {throw new Error('Deterministic completion check failed')}

    if (!checks.latency) {throw new Error(`First-token readiness exceeded latency limit (${latencyMs}ms)`)}

    const toolCall = await requestJson(
      base,
      '/v1/chat/completions',
      {
        method: 'POST',
        body: JSON.stringify({
          model: options.modelId,
          temperature: 0,
          seed: 0,
          max_tokens: 64,
          messages: [{ role: 'user', content: 'Run the verification tool with value 7.' }],
          tools: [
            {
              type: 'function',
              function: {
                name: TOOL_NAME,
                description: 'Verifies structured tool calling.',
                parameters: {
                  type: 'object',
                  additionalProperties: false,
                  properties: { value: { type: 'integer', const: 7 } },
                  required: ['value']
                }
              }
            }
          ],
          tool_choice: { type: 'function', function: { name: TOOL_NAME } }
        })
      },
      options,
      controller.signal
    )

    const call = toolCall?.choices?.[0]?.message?.tool_calls?.[0]
    let args: unknown

    try {
      args = JSON.parse(call?.function?.arguments ?? '')
    } catch {
      args = undefined
    }

    checks.toolCall =
      call?.type === 'function' &&
      call?.function?.name === TOOL_NAME &&
      typeof args === 'object' &&
      args !== null &&
      (args as { value?: unknown }).value === 7

    if (!checks.toolCall) {throw new Error('Structured tool-call check failed')}

    const contextProbeTokens = Math.max(128, Math.min(2048, options.contextProbeTokens ?? 512))

    const context = await requestJson(
      base,
      '/v1/chat/completions',
      {
        method: 'POST',
        body: JSON.stringify({
          model: options.modelId,
          temperature: 0,
          seed: 0,
          max_tokens: 16,
          messages: [
            {
              role: 'user',
              content: `${'readiness '.repeat(contextProbeTokens)}\nReply with exactly ${CONTEXT_SENTINEL}`
            }
          ]
        })
      },
      options,
      controller.signal
    )

    checks.context = context?.choices?.[0]?.message?.content?.trim() === CONTEXT_SENTINEL

    if (!checks.context) {throw new Error('Context-window smoke check failed')}

    return { ok: true, checks, latencyMs }
  } catch (error) {
    return { ok: false, checks, reason: error instanceof Error ? error.message : String(error) }
  } finally {
    clearTimeout(timeout)
  }
}

export const verificationConstants = { CONTEXT_SENTINEL, SENTINEL, TOOL_NAME }
