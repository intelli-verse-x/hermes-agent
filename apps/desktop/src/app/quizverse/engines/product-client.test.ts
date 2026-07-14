// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createSseAccumulator, parseSseEvents, productRequest, productStream } from './product-client'

describe('QuizVerse product client', () => {
  const request = vi.fn()

  beforeEach(() => {
    request.mockReset()
    Object.defineProperty(window, 'hermesDesktop', {
      configurable: true,
      value: { quizverse: { productRequest: request } }
    })
  })

  it('passes only structured requests to the main-process proxy', async () => {
    request.mockResolvedValue({ body: '{"items":[]}', contentType: 'application/json', status: 200 })

    await expect(productRequest<{ items: unknown[] }>({ method: 'GET', path: '/library' })).resolves.toEqual({
      contentType: 'application/json',
      data: { items: [] },
      status: 200
    })
    expect(request).toHaveBeenCalledWith({ method: 'GET', path: '/library' })
  })

  it('turns non-success responses into actionable setup errors', async () => {
    request.mockResolvedValue({
      body: '{"message":"Cognito sign-in required"}',
      contentType: 'application/json',
      status: 401
    })

    await expect(productRequest({ method: 'GET', path: '/graph' })).rejects.toThrow('Cognito sign-in required')
  })

  it('does not render upstream HTML error pages in native fallback copy', async () => {
    request.mockResolvedValue({
      body: '<html><body><h1>502 Bad Gateway</h1></body></html>',
      contentType: 'text/html',
      status: 502
    })

    await expect(productRequest({ method: 'GET', path: '/api/words/daily' })).rejects.toThrow(
      'QuizVerse product API failed (502): Upstream returned a non-JSON error response'
    )
  })

  it('parses JSON and text SSE events while ignoring completion markers', () => {
    expect(parseSseEvents('data: {"delta":"Hi"}\n\ndata: plain\n\ndata: [DONE]\n\n')).toEqual([
      { delta: 'Hi' },
      'plain'
    ])
  })

  it('renders split SSE frames incrementally through the cancellable main-process stream', async () => {
    const events: unknown[] = []
    const accumulate = createSseAccumulator(event => events.push(event))

    const stream = vi.fn(async (_input, onChunk: (chunk: string) => void) => {
      onChunk('data: {"delta":"Hel')
      expect(events).toEqual([])
      onChunk('lo"}\n\n')
      expect(events).toEqual([{ delta: 'Hello' }])

      return { body: 'data: {"delta":"Hello"}\n\n', contentType: 'text/event-stream', status: 200 }
    })

    Object.defineProperty(window, 'hermesDesktop', {
      configurable: true,
      value: { quizverse: { productRequest: request, productStream: stream } }
    })

    await expect(productStream({ path: '/notes/chat/chat-1/stream', streamId: 'stream_123' }, accumulate)).resolves.toMatchObject({
      status: 200
    })
  })
})
