import assert from 'node:assert/strict'
import test from 'node:test'

import {
  compactIxCloudHandoff,
  createEscalationGate,
  createWriteGate,
  newIxChatConversation,
  runIxChatTurn
} from './ix-chat'

function streamResponse(text: string, finishReason = 'stop') {
  const chunks = [
    `data: ${JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: null }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: finishReason }] })}\n\n`,
    'data: [DONE]\n\n'
  ]

  return new Response(chunks.join(''), { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

function options(
  fetchImpl: typeof fetch,
  mode: 'local-first' | 'local-only' | 'cloud-only'
): Parameters<typeof runIxChatTurn>[0] {
  const input: Parameters<typeof runIxChatTurn>[0] = {
    conversation: newIxChatConversation('gpt-4o-mini', []),
    userText: 'Summarize this request.',
    litellm: { baseUrl: 'https://router-api.intelli-verse-x.ai', apiKey: 'cloud-key' },
    localAi: {
      mode,
      available: true,
      endpoint: 'http://127.0.0.1:39281',
      apiKey: 'local-key',
      modelId: 'local-model',
      maxContextTokens: 8192
    },
    toolSpecs: [],
    callGatewayTool: async () => '',
    gate: createWriteGate(),
    escalationGate: {
      request: (_sessionId: string, _reason: string) => ({ nonce: 'approved', approval: Promise.resolve(true) }),
      resolve: (_sessionId: string, _nonce: string, _approved: boolean) => false
    },
    emit: () => undefined,
    fetchImpl
  }

  return input
}

test('native chat uses verified local inference without spending cloud tokens', async () => {
  const urls: string[] = []

  const fetchImpl = async (input: string | URL | Request) => {
    urls.push(String(input))

    return streamResponse('Local answer')
  }

  const input = options(fetchImpl as typeof fetch, 'local-first')
  await runIxChatTurn(input)

  assert.equal(urls.length, 1)
  assert.match(urls[0], /^http:\/\/127\.0\.0\.1:/)
  assert.equal(input.conversation.display.at(-1)?.text, 'Local answer')
})

test('objective empty local output escalates once through the LiteLLM edge route', async () => {
  const urls: string[] = []

  const fetchImpl = async (input: string | URL | Request) => {
    const url = String(input)
    urls.push(url)

    return url.startsWith('http://127.0.0.1') ? streamResponse('') : streamResponse('Cloud fallback')
  }

  const input = options(fetchImpl as typeof fetch, 'local-first')
  await runIxChatTurn(input)

  assert.equal(urls.length, 2)
  assert.match(urls[1], /^https:\/\/router-api\.intelli-verse-x\.ai/)
  assert.equal(input.conversation.display.at(-1)?.text, 'Cloud fallback')
})

test('local-only transport failure never reaches a cloud endpoint', async () => {
  const urls: string[] = []

  const fetchImpl = async (input: string | URL | Request) => {
    urls.push(String(input))
    throw new Error('local unavailable')
  }

  await assert.rejects(runIxChatTurn(options(fetchImpl as typeof fetch, 'local-only')), /local unavailable/)
  assert.equal(urls.length, 1)
  assert.match(urls[0], /^http:\/\/127\.0\.0\.1:/)
})

test('sensitive local-first turns never cloud-escalate after local validation failure', async () => {
  const urls: string[] = []

  const input = options((async (request: string | URL | Request) => {
    urls.push(String(request))

    return streamResponse('')
  }) as typeof fetch, 'local-first')

  input.userText = '[sensitive] summarize this locally'
  await assert.rejects(runIxChatTurn(input), /Sensitive input cannot use cloud fallback/)
  assert.equal(urls.length, 1)
  assert.match(urls[0], /^http:\/\/127\.0\.0\.1:/)
})

test('cloud fallback keeps bounded recent tool context', () => {
  const handoff = compactIxCloudHandoff(
    [
      { role: 'system', content: 'policy' },
      { role: 'user', content: 'inspect account' },
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          { id: 'call-1', type: 'function', function: { name: 'inspect', arguments: '{}' } },
          { id: 'call-2', type: 'function', function: { name: 'audit', arguments: '{}' } }
        ]
      },
      { role: 'tool', tool_call_id: 'call-1', content: 'account result' },
      { role: 'tool', tool_call_id: 'call-2', content: 'audit result' }
    ],
    1_000
  )

  assert.equal(handoff.length, 5)
  assert.equal(handoff.at(-1)?.content, 'audit result')
  assert.deepEqual(
    handoff[2].tool_calls.map((call: { id: string }) => call.id),
    ['call-1', 'call-2']
  )
})

test('cloud fallback waits for single-use session-bound approval', async () => {
  const gate = createEscalationGate(() => 1_000, 60_000)
  const urls: string[] = []
  let nonce = ''

  const input = options((async (request: string | URL | Request) => {
    const url = String(request)
    urls.push(url)

    return url.startsWith('http://127.0.0.1') ? streamResponse('') : streamResponse('Approved cloud')
  }) as typeof fetch, 'local-first')

  input.escalationGate = gate

  input.emit = event => {
    if (event.type === 'confirmation-required' && typeof event.nonce === 'string') {
      nonce = event.nonce
    }
  }

  const pending = runIxChatTurn(input)
  await new Promise(resolve => setTimeout(resolve, 10))
  assert.equal(urls.length, 1, 'cloud must not be contacted before approval')
  assert.ok(nonce)
  assert.equal(gate.resolve('wrong-session', nonce, true), false)
  assert.equal(gate.resolve(input.conversation.id, nonce, true), true)
  assert.equal(gate.resolve(input.conversation.id, nonce, true), false, 'approval nonce is single-use')
  await pending
  assert.equal(urls.length, 2)
})
