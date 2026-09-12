import assert from 'node:assert/strict'
import test from 'node:test'

import { probeExistingEndpoint, probeExistingEndpoints } from './endpoint-probe'
import { verificationConstants, verifyInference } from './verification'

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

test('existing endpoint probe permits only explicit loopback endpoints', async () => {
  const external = await probeExistingEndpoint('http://192.168.1.10:8080')
  assert.equal(external.ok, false)
  assert.match(external.reason ?? '', /loopback/)

  let authorization = ''

  const local = await probeExistingEndpoint('http://127.0.0.2:8080/', {
    apiKey: 'secret',
    fetchImpl: async (input, init) => {
      assert.equal(String(input), 'http://127.0.0.2:8080/v1/models')
      authorization = new Headers(init?.headers).get('authorization') ?? ''

      return jsonResponse({ data: [{ id: 'z-model' }, { id: 'a-model' }] })
    }
  })

  assert.equal(authorization, 'Bearer secret')
  assert.deepEqual(local.modelIds, ['a-model', 'z-model'])
})

test('candidate endpoint probing preserves configured order and omits failures', async () => {
  const endpoints = await probeExistingEndpoints({
    candidates: [
      { endpoint: 'http://127.0.0.1:11434', name: 'First' },
      { endpoint: 'http://127.0.0.1:1234', name: 'Second' }
    ],
    fetchImpl: async input =>
      String(input).includes('11434')
        ? jsonResponse({ data: [{ id: 'model-a' }] })
        : jsonResponse({ error: 'offline' }, 503)
  })

  assert.deepEqual(endpoints, [
    {
      endpoint: 'http://127.0.0.1:11434',
      name: 'First',
      models: ['model-a']
    }
  ])
})

test('inference verification checks models, exact completion, and structured tool call', async () => {
  const requests: Array<{ url: string; body?: any }> = []

  const result = await verifyInference({
    endpoint: 'http://[::1]:9090',
    apiKey: 'test-api-key',
    modelId: 'test-model',
    fetchImpl: async (input, init) => {
      const body = init?.body ? JSON.parse(String(init.body)) : undefined
      requests.push({ url: String(input), body })

      if (String(input).endsWith('/v1/models')) {
        return jsonResponse({ data: [{ id: 'test-model' }] })
      }

      if (body?.tools) {
        assert.equal(body.temperature, 0)
        assert.equal(body.tool_choice.function.name, verificationConstants.TOOL_NAME)

        return jsonResponse({
          choices: [
            {
              message: {
                tool_calls: [
                  {
                    type: 'function',
                    function: {
                      name: verificationConstants.TOOL_NAME,
                      arguments: '{"value":7}'
                    }
                  }
                ]
              }
            }
          ]
        })
      }

      if (body?.messages?.[0]?.content?.includes(verificationConstants.CONTEXT_SENTINEL)) {
        return jsonResponse({
          choices: [{ message: { content: verificationConstants.CONTEXT_SENTINEL } }]
        })
      }

      return jsonResponse({
        choices: [{ message: { content: verificationConstants.SENTINEL } }]
      })
    }
  })

  assert.equal(result.ok, true)
  assert.deepEqual(result.checks, {
    models: true,
    completion: true,
    toolCall: true,
    latency: true,
    context: true
  })
  assert.equal(requests.length, 4)
})

test('failed independent context verification never reports readiness', async () => {
  const result = await verifyInference({
    endpoint: 'http://127.0.0.1:9090',
    apiKey: 'test-api-key',
    modelId: 'test-model',
    fetchImpl: async (input, init) => {
      const body = init?.body ? JSON.parse(String(init.body)) : undefined

      if (String(input).endsWith('/v1/models')) {
        return jsonResponse({ data: [{ id: 'test-model' }] })
      }

      if (body?.tools) {
        return jsonResponse({
          choices: [
            {
              message: {
                tool_calls: [
                  {
                    type: 'function',
                    function: { name: verificationConstants.TOOL_NAME, arguments: '{"value":7}' }
                  }
                ]
              }
            }
          ]
        })
      }

      if (body?.messages?.[0]?.content?.includes(verificationConstants.CONTEXT_SENTINEL)) {
        return jsonResponse({ choices: [{ message: { content: 'WRONG' } }] })
      }

      return jsonResponse({ choices: [{ message: { content: verificationConstants.SENTINEL } }] })
    }
  })

  assert.equal(result.ok, false)
  assert.equal(result.checks.context, false)
  assert.match(result.reason ?? '', /Context-window smoke check failed/)
})
