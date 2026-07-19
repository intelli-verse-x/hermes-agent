import { isIP } from 'node:net'

export interface EndpointProbeResult {
  ok: boolean
  endpoint?: string
  modelIds?: string[]
  reason?: string
}

export interface EndpointProbeOptions {
  apiKey?: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

export interface ExistingEndpointCandidate {
  endpoint: string
  name: string
  apiKey?: string
}

export interface ExistingEndpoint {
  endpoint: string
  name: string
  models: string[]
}

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase()

  if (host === 'localhost' || host === '::1') {return true}

  if (isIP(host) === 4) {
    const first = Number(host.split('.')[0])

    return first === 127
  }

  return false
}

export function normalizeLoopbackEndpoint(value: string): URL {
  const url = new URL(value)

  if (!['http:', 'https:'].includes(url.protocol)) {throw new Error('Endpoint must use HTTP or HTTPS')}

  if (!isLoopbackHost(url.hostname)) {throw new Error('Endpoint must resolve explicitly to a loopback address')}

  if (url.username || url.password) {throw new Error('Endpoint URL must not contain credentials')}

  if (url.search || url.hash) {throw new Error('Endpoint URL must not contain a query or fragment')}
  url.pathname = url.pathname.replace(/\/+$/, '')

  return url
}

export async function probeExistingEndpoint(
  endpoint: string,
  options: EndpointProbeOptions = {}
): Promise<EndpointProbeResult> {
  let base: URL

  try {
    base = normalizeLoopbackEndpoint(endpoint)
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 3000)
  const url = new URL(base)
  url.pathname = `${base.pathname.replace(/\/+$/, '')}/v1/models`

  try {
    const response = await (options.fetchImpl ?? fetch)(url, {
      method: 'GET',
      redirect: 'error',
      signal: controller.signal,
      headers: options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : undefined
    })

    if (!response.ok) {return { ok: false, reason: `Endpoint returned HTTP ${response.status}` }}
    const body = (await response.json()) as { data?: Array<{ id?: unknown }> }

    if (!Array.isArray(body.data)) {return { ok: false, reason: 'Endpoint returned an invalid model list' }}

    const modelIds = body.data
      .map(item => item?.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0)
      .sort()

    return { ok: true, endpoint: base.toString().replace(/\/$/, ''), modelIds }
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) }
  } finally {
    clearTimeout(timeout)
  }
}

export async function probeExistingEndpoints(options: {
  candidates: ExistingEndpointCandidate[]
  timeoutMs?: number
  fetchImpl?: typeof fetch
}): Promise<ExistingEndpoint[]> {
  const results = await Promise.all(
    options.candidates.map(async candidate => ({
      candidate,
      result: await probeExistingEndpoint(candidate.endpoint, {
        apiKey: candidate.apiKey,
        timeoutMs: options.timeoutMs,
        fetchImpl: options.fetchImpl
      })
    }))
  )

  return results.flatMap(({ candidate, result }) =>
    result.ok
      ? [
          {
            endpoint: result.endpoint ?? candidate.endpoint,
            name: candidate.name,
            models: result.modelIds ?? []
          }
        ]
      : []
  )
}

export const endpointProbeInternals = { isLoopbackHost }
