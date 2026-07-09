/**
 * Tests for electron/ix-mcp-health.ts — per-MCP-server health lamps.
 *
 * Run with: NODE_OPTIONS="--import tsx" node --test electron/ix-mcp-health.test.ts
 *
 * Why this matters: the Tools tab paints a lamp per tile, so the probe must
 * classify green/grey/red exactly like the gateway lamp does (green =
 * tools/list inventory, grey = auth missing/rejected, red = unreachable) —
 * across all three probe paths (gateway admin_call_mcp, direct fallback,
 * portal dynamic-connector probe).
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  isClusterLocalUrl,
  probeDirectMcp,
  probeDynamicConnector,
  probeGatewayTile,
  probeMcpHealth
} from './ix-mcp-health'

const GATEWAY = 'https://admin-mcp.example.com/'

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers }
  })
}

function gatewayToolsListResponse(toolCount: number) {
  const tools = Array.from({ length: toolCount }, (_, i) => ({ name: `tool_${i}` }))

  return jsonResponse({
    jsonrpc: '2.0',
    id: 1,
    result: { content: [{ type: 'text', text: JSON.stringify({ tools }) }] }
  })
}

/* ── cluster-local detection ─────────────────────────────────────────────── */

test('isClusterLocalUrl spots in-cluster service DNS only', () => {
  assert.equal(isClusterLocalUrl('http://stripe-mcp.aicart.svc.cluster.local/'), true)
  assert.equal(isClusterLocalUrl('https://notifuse-mcp.intelli-verse-x.ai/mcp'), false)
  assert.equal(isClusterLocalUrl('not a url'), false)
})

/* ── gateway probe ───────────────────────────────────────────────────────── */

test('gateway probe goes green with the tool count from admin_call_mcp', async () => {
  let seenBody: Record<string, unknown> = {}

  const fakeFetch = (async (_url: string, init: RequestInit) => {
    seenBody = JSON.parse(String(init.body))

    return gatewayToolsListResponse(12)
  }) as unknown as typeof fetch

  const result = await probeGatewayTile(GATEWAY, 'tok', { tileId: 'stripe' }, fakeFetch)

  assert.equal(result.state, 'green')
  assert.equal(result.toolCount, 12)

  const params = seenBody.params as { arguments: Record<string, unknown>; name: string }

  assert.equal(params.name, 'admin_call_mcp')
  assert.deepEqual(params.arguments, { tileId: 'stripe', method: 'tools/list' })
})

test('gateway probe reports grey on a rejected gateway token', async () => {
  const fakeFetch = (async () => jsonResponse({ error: 'unauthorized' }, 401)) as unknown as typeof fetch
  const result = await probeGatewayTile(GATEWAY, 'bad', { tileId: 'stripe' }, fakeFetch)

  assert.equal(result.state, 'grey')
  assert.match(result.detail, /401/)
})

test('gateway probe classifies tile-side auth failures as grey, others red', async () => {
  const toolError = (text: string) =>
    (async () =>
      jsonResponse({
        jsonrpc: '2.0',
        id: 1,
        result: { isError: true, content: [{ type: 'text', text }] }
      })) as unknown as typeof fetch

  const authFail = await probeGatewayTile(GATEWAY, 'tok', { tileId: 'didit' }, toolError('HTTP 401 invalid_token'))

  assert.equal(authFail.state, 'grey')

  const hardFail = await probeGatewayTile(GATEWAY, 'tok', { tileId: 'didit' }, toolError('connect ECONNREFUSED'))

  assert.equal(hardFail.state, 'red')
})

test('gateway probe with no token: public tiles fall back to a direct tools/list', async () => {
  let directUrl = ''

  const fakeFetch = (async (url: string) => {
    directUrl = url

    return jsonResponse({ jsonrpc: '2.0', id: 1, result: { tools: [{ name: 'a' }, { name: 'b' }] } })
  }) as unknown as typeof fetch

  const result = await probeGatewayTile(
    GATEWAY,
    '',
    { tileId: 'notifuse', mcpUrl: 'https://notifuse-mcp.intelli-verse-x.ai/mcp' },
    fakeFetch
  )

  assert.equal(directUrl, 'https://notifuse-mcp.intelli-verse-x.ai/mcp')
  assert.equal(result.state, 'green')
  assert.equal(result.toolCount, 2)
})

test('gateway probe with no token: in-cluster tiles report grey (gateway required)', async () => {
  const neverCalled = (async () => {
    throw new Error('should not fetch')
  }) as unknown as typeof fetch

  const result = await probeGatewayTile(
    GATEWAY,
    '',
    { tileId: 'stripe', mcpUrl: 'http://stripe-mcp.aicart.svc.cluster.local/' },
    neverCalled
  )

  assert.equal(result.state, 'grey')
  assert.match(result.detail, /gateway token/i)
})

test('gateway probe reports red when the gateway is unreachable', async () => {
  const failing = (async () => {
    throw new Error('fetch failed')
  }) as unknown as typeof fetch

  const result = await probeGatewayTile(GATEWAY, 'tok', { tileId: 'stripe' }, failing)

  assert.equal(result.state, 'red')
  assert.match(result.detail, /fetch failed/)
})

/* ── direct probe ────────────────────────────────────────────────────────── */

test('direct probe: 401 grey, HTTP 500 red, SSE responses parsed', async () => {
  const status401 = (async () => new Response('', { status: 401 })) as unknown as typeof fetch

  assert.equal((await probeDirectMcp('t', 'https://mcp.example.com/', status401)).state, 'grey')

  const status500 = (async () => new Response('', { status: 500 })) as unknown as typeof fetch

  assert.equal((await probeDirectMcp('t', 'https://mcp.example.com/', status500)).state, 'red')

  const sse = (async () =>
    new Response(`event: message\ndata: ${JSON.stringify({ id: 1, result: { tools: [{ name: 'x' }] } })}\n\n`, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' }
    })) as unknown as typeof fetch

  const streamed = await probeDirectMcp('t', 'https://mcp.example.com/', sse)

  assert.equal(streamed.state, 'green')
  assert.equal(streamed.toolCount, 1)
})

/* ── dynamic connector probe (portal /test) ──────────────────────────────── */

test('dynamic probe green on portal ok, grey on session 401, red on probe failure', async () => {
  const ok = (async (url: string, init: RequestInit) => {
    assert.match(url, /\/api\/portal\/connectors\/dynamic\/test$/)
    assert.deepEqual(JSON.parse(String(init.body)), { id: 'metabase' })

    return jsonResponse({ ok: true, toolCount: 7, tools: [] })
  }) as unknown as typeof fetch

  const green = await probeDynamicConnector('https://portal.example.com', 'metabase', ok)

  assert.equal(green.state, 'green')
  assert.equal(green.toolCount, 7)

  const noSession = (async () => jsonResponse({ error: 'auth_required' }, 401)) as unknown as typeof fetch

  assert.equal((await probeDynamicConnector('https://portal.example.com', 'metabase', noSession)).state, 'grey')

  const probeFail = (async () =>
    jsonResponse({ ok: false, error: 'probe_failed', message: 'MCP tools/list → HTTP 502' }, 502)) as unknown as typeof fetch

  assert.equal((await probeDynamicConnector('https://portal.example.com', 'metabase', probeFail)).state, 'red')

  const probeAuth = (async () =>
    jsonResponse({ ok: false, error: 'probe_failed', message: 'MCP tools/list → HTTP 401' }, 502)) as unknown as typeof fetch

  assert.equal((await probeDynamicConnector('https://portal.example.com', 'metabase', probeAuth)).state, 'grey')
})

/* ── batch probing ───────────────────────────────────────────────────────── */

test('probeMcpHealth probes every target and never throws', async () => {
  const fetchImpl = (async (url: string) => {
    if (url.startsWith(GATEWAY)) {
      return gatewayToolsListResponse(3)
    }

    throw new Error('unexpected url')
  }) as unknown as typeof fetch

  const portalFetch = (async () => jsonResponse({ ok: true, toolCount: 5 })) as unknown as typeof fetch

  const results = await probeMcpHealth(
    [
      { tileId: 'stripe', kind: 'gateway' },
      { tileId: 'metabase', kind: 'dynamic' }
    ],
    {
      gatewayUrl: GATEWAY,
      gatewayToken: 'tok',
      portalUrl: 'https://portal.example.com',
      fetchImpl,
      portalFetch
    }
  )

  assert.deepEqual(
    results.map(r => [r.tileId, r.state, r.toolCount]),
    [
      ['stripe', 'green', 3],
      ['metabase', 'green', 5]
    ]
  )
})
