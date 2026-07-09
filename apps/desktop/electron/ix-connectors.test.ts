/**
 * Tests for electron/ix-connectors.ts — the dynamic-connector portal client
 * and the JSON import/export helpers.
 *
 * Run with: NODE_OPTIONS="--import tsx" node --test electron/ix-connectors.test.ts
 *
 * Why this matters: the desktop must mirror the web AddConnectorPanel's API
 * contract exactly (list strips tokens, save POSTs the token write-only,
 * test uses the stored token when only an id is sent), and exported JSON
 * must NEVER contain a credential.
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  deleteIxConnector,
  exportConnectorsJson,
  type IxDynamicConnector,
  listIxConnectors,
  parseConnectorImport,
  saveIxConnector,
  setIxConnectorEnabled,
  testIxConnector
} from './ix-connectors'

const PORTAL = 'https://portal.example.com'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

const PUBLIC_ROW = {
  id: 'metabase',
  label: 'Metabase MCP',
  url: 'https://mcp.metabase.example.com/mcp',
  transport: 'remote-mcp',
  authHeader: 'Authorization',
  hasToken: true,
  category: 'analytics',
  appIds: ['quizverse'],
  bundles: ['analytics'],
  readOnlyTools: ['list', 'get'],
  enabled: true,
  createdBy: 'admin@ix.ai',
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-02T00:00:00.000Z',
  toolCount: 9
}

/* ── portal client ───────────────────────────────────────────────────────── */

test('listIxConnectors GETs the registry and sanitizes rows', async () => {
  let seenUrl = ''

  const fakeFetch = (async (url: string) => {
    seenUrl = url

    return jsonResponse({ data: [PUBLIC_ROW, { id: 'junk', label: 7, transport: 'weird' }] })
  }) as unknown as typeof fetch

  const rows = await listIxConnectors(PORTAL, fakeFetch)

  assert.equal(seenUrl, `${PORTAL}/api/portal/connectors/dynamic`)
  assert.equal(rows.length, 2)
  assert.equal(rows[0].id, 'metabase')
  assert.equal(rows[0].hasToken, true)
  assert.equal(rows[0].toolCount, 9)
  // Sloppy rows are coerced, not thrown on.
  assert.equal(rows[1].transport, 'remote-mcp')
  assert.equal(rows[1].enabled, true)
})

test('listIxConnectors maps 401/403 to actionable messages', async () => {
  const noSession = (async () => jsonResponse({ error: 'auth_required' }, 401)) as unknown as typeof fetch

  await assert.rejects(() => listIxConnectors(PORTAL, noSession), /sign in/i)

  const pinned = (async () => jsonResponse({ error: 'forbidden' }, 403)) as unknown as typeof fetch

  await assert.rejects(() => listIxConnectors(PORTAL, pinned), /super-admin/i)
})

test('saveIxConnector validates locally then POSTs the full definition', async () => {
  let seenBody: Record<string, unknown> = {}

  const fakeFetch = (async (_url: string, init: RequestInit) => {
    seenBody = JSON.parse(String(init.body))

    return jsonResponse({ data: PUBLIC_ROW }, 201)
  }) as unknown as typeof fetch

  await assert.rejects(
    () =>
      saveIxConnector(
        PORTAL,
        { label: '', url: 'https://x', transport: 'remote-mcp', authHeader: '', category: 'analytics', appIds: [], bundles: [], readOnlyTools: [] },
        fakeFetch
      ),
    /name/
  )

  await assert.rejects(
    () =>
      saveIxConnector(
        PORTAL,
        { label: 'X', url: 'ftp://x', transport: 'remote-mcp', authHeader: '', category: 'analytics', appIds: [], bundles: [], readOnlyTools: [] },
        fakeFetch
      ),
    /http/
  )

  const saved = await saveIxConnector(
    PORTAL,
    {
      label: ' Metabase MCP ',
      url: ' https://mcp.metabase.example.com/mcp ',
      transport: 'cluster-mcp',
      authHeader: ' ',
      token: ' secret ',
      category: 'analytics',
      appIds: ['quizverse'],
      bundles: ['analytics'],
      readOnlyTools: [' list ', '', 'get']
    },
    fakeFetch
  )

  assert.equal(saved.id, 'metabase')
  assert.equal(seenBody.label, 'Metabase MCP')
  assert.equal(seenBody.transport, 'cluster-mcp')
  // Blank auth header falls back to the portal default.
  assert.equal(seenBody.authHeader, 'Authorization')
  assert.equal(seenBody.token, 'secret')
  assert.deepEqual(seenBody.readOnlyTools, ['list', 'get'])
})

test('setIxConnectorEnabled PATCHes and deleteIxConnector DELETEs the per-id route', async () => {
  const calls: { method: string; url: string; body?: unknown }[] = []

  const fakeFetch = (async (url: string, init?: RequestInit) => {
    calls.push({ method: init?.method ?? 'GET', url, body: init?.body ? JSON.parse(String(init.body)) : undefined })

    return init?.method === 'DELETE' ? jsonResponse({ ok: true }) : jsonResponse({ data: { ...PUBLIC_ROW, enabled: false } })
  }) as unknown as typeof fetch

  const patched = await setIxConnectorEnabled(PORTAL, 'metabase', false, fakeFetch)

  assert.equal(patched.enabled, false)
  await deleteIxConnector(PORTAL, 'metabase', fakeFetch)

  assert.deepEqual(
    calls.map(c => [c.method, c.url]),
    [
      ['PATCH', `${PORTAL}/api/portal/connectors/dynamic/metabase`],
      ['DELETE', `${PORTAL}/api/portal/connectors/dynamic/metabase`]
    ]
  )
  assert.deepEqual(calls[0].body, { enabled: false })
})

test('testIxConnector sends only the id for saved connectors (stored token)', async () => {
  let seenBody: Record<string, unknown> = {}

  const fakeFetch = (async (_url: string, init: RequestInit) => {
    seenBody = JSON.parse(String(init.body))

    return jsonResponse({ ok: true, toolCount: 4, tools: ['a', 'b'] })
  }) as unknown as typeof fetch

  const result = await testIxConnector(PORTAL, { id: 'metabase', token: 'should-not-be-sent' }, fakeFetch)

  assert.deepEqual(seenBody, { id: 'metabase' })
  assert.equal(result.ok, true)
  assert.equal(result.toolCount, 4)

  const failing = (async () =>
    jsonResponse({ ok: false, error: 'probe_failed', message: 'MCP tools/list → HTTP 502' }, 502)) as unknown as typeof fetch

  const failed = await testIxConnector(PORTAL, { url: 'https://mcp.example.com/' }, failing)

  assert.equal(failed.ok, false)
  assert.match(failed.message, /502/)
})

/* ── JSON import ─────────────────────────────────────────────────────────── */

test('parseConnectorImport accepts a single object and an array', () => {
  const single = parseConnectorImport(
    JSON.stringify({ label: 'PostHog', url: 'https://mcp.posthog.com/mcp', token: 'phx_secret' })
  )

  assert.deepEqual(single.errors, [])
  assert.equal(single.connectors.length, 1)
  assert.equal(single.connectors[0].label, 'PostHog')
  assert.equal(single.connectors[0].token, 'phx_secret')
  assert.equal(single.connectors[0].transport, 'remote-mcp')
  assert.equal(single.connectors[0].category, 'analytics')

  const bulk = parseConnectorImport(
    JSON.stringify([
      { label: 'A', url: 'https://a.example.com/', bundles: ['revenue', 'nope'], appIds: 'quizverse, questx, fake' },
      { label: 'B', url: 'https://b.example.com/', readOnlyTools: 'list, get' }
    ])
  )

  assert.deepEqual(bulk.errors, [])
  assert.equal(bulk.connectors.length, 2)
  // Unknown bundles/app-ids are dropped; comma strings are accepted.
  assert.deepEqual(bulk.connectors[0].bundles, ['revenue'])
  assert.deepEqual(bulk.connectors[0].appIds, ['quizverse', 'questx'])
  assert.deepEqual(bulk.connectors[1].readOnlyTools, ['list', 'get'])
})

test('parseConnectorImport reports invalid entries but keeps valid ones', () => {
  const mixed = parseConnectorImport(
    JSON.stringify([{ label: 'Good', url: 'https://ok.example.com/' }, { label: 'No URL' }, 'nonsense'])
  )

  assert.equal(mixed.connectors.length, 1)
  assert.equal(mixed.errors.length, 2)
  assert.match(mixed.errors[0], /url/i)

  const garbage = parseConnectorImport('{not json')

  assert.equal(garbage.connectors.length, 0)
  assert.match(garbage.errors[0], /not valid json/i)
})

/* ── JSON export ─────────────────────────────────────────────────────────── */

test('exportConnectorsJson never leaks tokens or server-side fields', () => {
  const exported = exportConnectorsJson([PUBLIC_ROW as unknown as IxDynamicConnector])
  const rows = JSON.parse(exported) as Record<string, unknown>[]

  assert.equal(rows.length, 1)
  assert.equal(rows[0].id, 'metabase')
  assert.ok(!('token' in rows[0]))
  assert.ok(!('hasToken' in rows[0]))
  assert.ok(!('createdBy' in rows[0]))
  assert.ok(!exported.includes('secret'))

  // Round-trips through the importer.
  const reimported = parseConnectorImport(exported)

  assert.deepEqual(reimported.errors, [])
  assert.equal(reimported.connectors[0].label, 'Metabase MCP')
})
