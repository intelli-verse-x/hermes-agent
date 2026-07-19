import fs from 'node:fs/promises'
import path from 'node:path'

const endpoint = (process.env.LOCAL_AI_SMOKE_ENDPOINT || 'http://127.0.0.1:11434').replace(/\/+$/, '')
const model = process.env.LOCAL_AI_SMOKE_MODEL
const output = process.env.LOCAL_AI_SMOKE_OUTPUT || path.resolve('artifacts/local-ai-smoke.json')
const headers = {
  'content-type': 'application/json',
  authorization: `Bearer ${process.env.LOCAL_AI_SMOKE_API_KEY || 'no-key-required'}`
}
const checks = {}

async function request(route, body) {
  const started = performance.now()
  const response = await fetch(`${endpoint}${route}`, {
    method: body ? 'POST' : 'GET',
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(120_000)
  })
  const payload = await response.json()

  return { ok: response.ok, payload, latencyMs: Math.round(performance.now() - started) }
}

const models = await request('/v1/models')
const modelId = model || models.payload?.data?.[0]?.id
checks.models = { ok: models.ok && Boolean(modelId), latencyMs: models.latencyMs }
if (!modelId) {throw new Error('No model was advertised; set LOCAL_AI_SMOKE_MODEL explicitly')}

const completion = await request('/v1/chat/completions', {
  model: modelId,
  temperature: 0,
  messages: [{ role: 'user', content: 'Reply with exactly READY.' }]
})
checks.completion = {
  ok: completion.ok && completion.payload?.choices?.[0]?.message?.content?.trim() === 'READY',
  latencyMs: completion.latencyMs,
  usage: completion.payload?.usage
    ? {
        inputTokens: Number(completion.payload.usage.prompt_tokens) || 0,
        outputTokens: Number(completion.payload.usage.completion_tokens) || 0
      }
    : null
}

const tool = await request('/v1/chat/completions', {
  model: modelId,
  temperature: 0,
  messages: [{ role: 'user', content: 'Use the readiness tool with value 7.' }],
  tools: [
    {
      type: 'function',
      function: {
        name: 'readiness',
        description: 'Deterministic readiness probe',
        parameters: {
          type: 'object',
          properties: { value: { type: 'integer' } },
          required: ['value'],
          additionalProperties: false
        }
      }
    }
  ],
  tool_choice: { type: 'function', function: { name: 'readiness' } }
})
const call = tool.payload?.choices?.[0]?.message?.tool_calls?.[0]
let args
try {
  args = JSON.parse(call?.function?.arguments || '')
} catch {
  args = null
}
checks.structuredTool = {
  ok: tool.ok && call?.function?.name === 'readiness' && args?.value === 7,
  latencyMs: tool.latencyMs
}

const artifact = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  endpointOrigin: new URL(endpoint).origin,
  modelId,
  checks,
  passed: Object.values(checks).every(check => check.ok),
  privacy: { promptContentPersisted: false, responseContentPersisted: false }
}
await fs.mkdir(path.dirname(output), { recursive: true })
await fs.writeFile(output, `${JSON.stringify(artifact, null, 2)}\n`, { mode: 0o600 })
console.log(`${artifact.passed ? 'PASS' : 'FAIL'} ${output}`)
if (!artifact.passed) {process.exitCode = 1}
