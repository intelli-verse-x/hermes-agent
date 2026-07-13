import type { QuizverseProductRequest } from '@/global'

export interface ProductResult<T> {
  contentType: string
  data: T
  etag?: string
  offline?: boolean
  status: number
}

export async function productRequest<T>(input: QuizverseProductRequest): Promise<ProductResult<T>> {
  const bridge = window.hermesDesktop?.quizverse

  if (!bridge?.productRequest) {
    throw new Error('QuizVerse product proxy is unavailable in this build')
  }

  const response = await bridge.productRequest(input)
  let data: T

  try {
    data = JSON.parse(response.body) as T
  } catch {
    data = response.body as T
  }

  if (response.status < 200 || response.status >= 300) {
    const detail =
      typeof data === 'object' && data && 'message' in data
        ? String((data as { message?: unknown }).message)
        : response.contentType.includes('application/json')
          ? response.body.slice(0, 300)
          : 'Upstream returned a non-JSON error response'

    throw new Error(`QuizVerse product API failed (${response.status}): ${detail || 'No response body'}`)
  }

  return {
    contentType: response.contentType,
    data,
    etag: response.etag,
    offline: response.offline,
    status: response.status
  }
}

export async function productStream(
  input: QuizverseProductRequest,
  onChunk: (chunk: string) => void
): Promise<ProductResult<string>> {
  const bridge = window.hermesDesktop?.quizverse

  if (!bridge?.productStream) {
    throw new Error('QuizVerse product streaming proxy is unavailable in this build')
  }

  const response = await bridge.productStream(input, onChunk)

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`QuizVerse product API failed (${response.status})`)
  }

  return {
    contentType: response.contentType,
    data: response.body,
    status: response.status
  }
}

export function createSseAccumulator(onEvent: (event: unknown) => void) {
  let buffer = ''

  return (chunk: string, flush = false) => {
    buffer += chunk
    const frames = buffer.split(/\r?\n\r?\n/)
    const trailing = frames.pop() ?? ''
    buffer = flush ? '' : trailing
    const ready = flush ? frames.concat(trailing ? [trailing] : []) : frames

    for (const frame of ready) {
      for (const event of parseSseEvents(`${frame}\n\n`)) {
        onEvent(event)
      }
    }
  }
}

export function parseSseEvents(body: string): unknown[] {
  return body
    .split(/\r?\n\r?\n/)
    .flatMap(frame =>
      frame
        .split(/\r?\n/)
        .filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).trim())
    )
    .filter(value => value && value !== '[DONE]')
    .map(value => {
      try {
        return JSON.parse(value)
      } catch {
        return value
      }
    })
}
