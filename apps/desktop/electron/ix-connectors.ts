/**
 * Dynamic MCP connectors — the desktop client of the admin portal's
 * self-serve "Add a connector" registry (super-admin only, enforced
 * server-side against the signed portal scope):
 *
 *   GET    /api/portal/connectors/dynamic        → { data: publicRows }
 *   POST   /api/portal/connectors/dynamic        → create/update
 *   PATCH  /api/portal/connectors/dynamic/:id    → { enabled }
 *   DELETE /api/portal/connectors/dynamic/:id
 *   POST   /api/portal/connectors/dynamic/test   → tools/list probe
 *
 * All calls run through the signed-in OTP session's cookie-jar fetch (main
 * process). Tokens are write-only: the portal strips them from every list
 * response (`hasToken` flag), so a credential never lands in the desktop
 * after save — mirroring AddConnectorPanel.tsx in the webfrontend.
 *
 * Also holds the pure JSON import/export helpers (bulk-register connector
 * definitions from pasted JSON; export the registry WITHOUT tokens).
 *
 * Pure logic with injected fetch — see ix-connectors.test.ts.
 */

export type IxConnectorTransport = 'cluster-mcp' | 'remote-mcp'

export const IX_CONNECTOR_TRANSPORTS: readonly IxConnectorTransport[] = ['remote-mcp', 'cluster-mcp']

// Mirrors the webfrontend's app-registry (src/lib/app-registry.ts) — the
// desktop bundles no registry data, so the ids/labels are pinned here.
export const IX_CONNECTOR_APPS: readonly { id: string; label: string }[] = [
  { id: 'quizverse', label: 'QuizVerse' },
  { id: 'questx', label: 'QuestX' },
  { id: 'intelliverse', label: 'IntelliVerse X' },
  { id: 'toba', label: 'ToBa Tech' },
  { id: 'contentx', label: 'ContentX Studio' },
  { id: 'foundrly', label: 'Foundrly' },
  { id: 'kioskx', label: 'Kiosk X' }
]

export const IX_CAPABILITY_BUNDLES: readonly { id: string; label: string }[] = [
  { id: 'revenue', label: 'Revenue & Payments' },
  { id: 'growth', label: 'Growth & Marketing' },
  { id: 'support', label: 'Support & Customer Ops' },
  { id: 'content', label: 'Content & Product Ops' },
  { id: 'analytics', label: 'Analytics & Insights' },
  { id: 'engineering', label: 'Engineering & Infra' }
]

const BUNDLE_IDS = IX_CAPABILITY_BUNDLES.map(bundle => bundle.id)

const APP_IDS = IX_CONNECTOR_APPS.map(app => app.id)

/** Browser-safe row the portal returns (token stripped server-side). */
export interface IxDynamicConnector {
  id: string
  label: string
  url: string
  transport: IxConnectorTransport
  authHeader: string
  hasToken: boolean
  category: string
  appIds: string[]
  bundles: string[]
  readOnlyTools: string[]
  enabled: boolean
  lastTestedAt?: string
  toolCount?: number
  toolNames?: string[]
}

/** What the desktop form/import submits (token write-only). */
export interface IxConnectorDraft {
  id?: string
  label: string
  url: string
  transport: IxConnectorTransport
  authHeader: string
  token?: string
  category: string
  appIds: string[]
  bundles: string[]
  readOnlyTools: string[]
  enabled?: boolean
}

const REQUEST_TIMEOUT_MS = 15_000

async function readPortalError(res: Response, fallback: string): Promise<string> {
  if (res.status === 401) {
    return 'Sign in to IX Agency first — the portal session is not active.'
  }

  if (res.status === 403) {
    return 'Dynamic connectors are super-admin only.'
  }

  try {
    const body = (await res.json()) as { error?: string; message?: string }

    if (body?.message || body?.error) {
      return body.message || body.error || fallback
    }
  } catch {
    // non-JSON error body — use the fallback
  }

  return fallback
}

function sanitizeConnectorRow(raw: Record<string, unknown>): IxDynamicConnector {
  const strings = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []

  return {
    id: String(raw.id ?? ''),
    label: String(raw.label ?? ''),
    url: String(raw.url ?? ''),
    transport: raw.transport === 'cluster-mcp' ? 'cluster-mcp' : 'remote-mcp',
    authHeader: String(raw.authHeader ?? 'Authorization'),
    hasToken: Boolean(raw.hasToken),
    category: String(raw.category ?? 'analytics'),
    appIds: strings(raw.appIds),
    bundles: strings(raw.bundles),
    readOnlyTools: strings(raw.readOnlyTools),
    enabled: raw.enabled !== false,
    ...(typeof raw.lastTestedAt === 'string' ? { lastTestedAt: raw.lastTestedAt } : {}),
    ...(typeof raw.toolCount === 'number' ? { toolCount: raw.toolCount } : {}),
    ...(Array.isArray(raw.toolNames) ? { toolNames: strings(raw.toolNames) } : {})
  }
}

export async function listIxConnectors(portalUrl: string, fetchImpl: typeof fetch): Promise<IxDynamicConnector[]> {
  const res = await fetchImpl(new URL('/api/portal/connectors/dynamic', portalUrl).toString(), {
    method: 'GET',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  })

  if (!res.ok) {
    throw new Error(await readPortalError(res, `Could not list connectors (HTTP ${res.status}).`))
  }

  const body = (await res.json()) as { data?: Record<string, unknown>[] }

  return (Array.isArray(body?.data) ? body.data : []).map(sanitizeConnectorRow)
}

export async function saveIxConnector(
  portalUrl: string,
  draft: IxConnectorDraft,
  fetchImpl: typeof fetch
): Promise<IxDynamicConnector> {
  const label = String(draft.label ?? '').trim()
  const url = String(draft.url ?? '').trim()

  if (!label) {
    throw new Error('A connector needs a name.')
  }

  if (!/^https?:\/\//i.test(url)) {
    throw new Error('MCP URL must start with http(s)://')
  }

  const res = await fetchImpl(new URL('/api/portal/connectors/dynamic', portalUrl).toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...(draft.id ? { id: draft.id } : {}),
      label,
      url,
      transport: draft.transport === 'cluster-mcp' ? 'cluster-mcp' : 'remote-mcp',
      authHeader: String(draft.authHeader ?? '').trim() || 'Authorization',
      token: String(draft.token ?? '').trim(),
      category: draft.category,
      appIds: draft.appIds ?? [],
      bundles: draft.bundles ?? [],
      readOnlyTools: (draft.readOnlyTools ?? []).map(prefix => prefix.trim()).filter(Boolean),
      ...(typeof draft.enabled === 'boolean' ? { enabled: draft.enabled } : {})
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  })

  if (!res.ok) {
    throw new Error(await readPortalError(res, `The portal rejected the connector (HTTP ${res.status}).`))
  }

  const body = (await res.json()) as { data?: Record<string, unknown> }

  if (!body?.data) {
    throw new Error('The portal returned no connector data.')
  }

  return sanitizeConnectorRow(body.data)
}

export async function setIxConnectorEnabled(
  portalUrl: string,
  id: string,
  enabled: boolean,
  fetchImpl: typeof fetch
): Promise<IxDynamicConnector> {
  const res = await fetchImpl(
    new URL(`/api/portal/connectors/dynamic/${encodeURIComponent(id)}`, portalUrl).toString(),
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    }
  )

  if (!res.ok) {
    throw new Error(await readPortalError(res, `Could not update the connector (HTTP ${res.status}).`))
  }

  const body = (await res.json()) as { data?: Record<string, unknown> }

  if (!body?.data) {
    throw new Error('The portal returned no connector data.')
  }

  return sanitizeConnectorRow(body.data)
}

export async function deleteIxConnector(portalUrl: string, id: string, fetchImpl: typeof fetch): Promise<void> {
  const res = await fetchImpl(
    new URL(`/api/portal/connectors/dynamic/${encodeURIComponent(id)}`, portalUrl).toString(),
    { method: 'DELETE', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }
  )

  if (!res.ok) {
    throw new Error(await readPortalError(res, `Could not delete the connector (HTTP ${res.status}).`))
  }
}

export interface IxConnectorTestResult {
  ok: boolean
  message: string
  toolCount?: number
  tools?: string[]
}

/**
 * Live "Test connection" through the portal's server-side probe. Pass `id`
 * alone to re-test a saved connector with its STORED token; pass url/header/
 * token to test an unsaved form.
 */
export async function testIxConnector(
  portalUrl: string,
  payload: { authHeader?: string; id?: string; token?: string; url?: string },
  fetchImpl: typeof fetch
): Promise<IxConnectorTestResult> {
  const res = await fetchImpl(new URL('/api/portal/connectors/dynamic/test', portalUrl).toString(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(
      payload.id
        ? { id: payload.id }
        : {
            url: String(payload.url ?? '').trim(),
            authHeader: String(payload.authHeader ?? '').trim() || 'Authorization',
            token: String(payload.token ?? '').trim()
          }
    ),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  })

  const body = (await res.json().catch(() => null)) as null | {
    error?: string
    message?: string
    ok?: boolean
    toolCount?: number
    tools?: string[]
  }

  if (res.ok && body?.ok) {
    const toolCount = typeof body.toolCount === 'number' ? body.toolCount : 0

    return {
      ok: true,
      message: `Connected — ${toolCount} tool${toolCount === 1 ? '' : 's'} discovered`,
      toolCount,
      tools: Array.isArray(body.tools) ? body.tools.filter((t): t is string => typeof t === 'string') : []
    }
  }

  return {
    ok: false,
    message: body?.message || body?.error || (await readPortalError(res, `Connection test failed (HTTP ${res.status}).`))
  }
}

/* ── JSON import / export ───────────────────────────────────────────────────── */

export interface IxConnectorImportResult {
  connectors: IxConnectorDraft[]
  errors: string[]
}

function coerceStringList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string').map(item => item.trim()).filter(Boolean)
  }

  if (typeof value === 'string') {
    return value
      .split(',')
      .map(item => item.trim())
      .filter(Boolean)
  }

  return []
}

function coerceDraft(raw: unknown, index: number, errors: string[]): IxConnectorDraft | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    errors.push(`Entry ${index + 1}: not a JSON object.`)

    return null
  }

  const source = raw as Record<string, unknown>
  const label = String(source.label ?? source.name ?? '').trim()
  const url = String(source.url ?? source.mcpUrl ?? '').trim()

  if (!label) {
    errors.push(`Entry ${index + 1}: "label" is required.`)

    return null
  }

  if (!/^https?:\/\//i.test(url)) {
    errors.push(`Entry ${index + 1} (${label}): "url" must start with http(s)://`)

    return null
  }

  const category = String(source.category ?? '').trim()

  return {
    ...(typeof source.id === 'string' && source.id.trim() ? { id: source.id.trim() } : {}),
    label,
    url,
    transport: source.transport === 'cluster-mcp' ? 'cluster-mcp' : 'remote-mcp',
    authHeader: String(source.authHeader ?? '').trim() || 'Authorization',
    ...(typeof source.token === 'string' && source.token.trim() ? { token: source.token.trim() } : {}),
    category: BUNDLE_IDS.includes(category) ? category : 'analytics',
    appIds: coerceStringList(source.appIds).filter(id => APP_IDS.includes(id)),
    bundles: coerceStringList(source.bundles).filter(id => BUNDLE_IDS.includes(id)),
    readOnlyTools: coerceStringList(source.readOnlyTools),
    ...(typeof source.enabled === 'boolean' ? { enabled: source.enabled } : {})
  }
}

/**
 * Parse pasted JSON into connector drafts: a single object prefills the form,
 * an array bulk-registers. Invalid entries are reported, valid ones kept.
 */
export function parseConnectorImport(rawJson: string): IxConnectorImportResult {
  let parsed: unknown

  try {
    parsed = JSON.parse(rawJson)
  } catch (error) {
    return { connectors: [], errors: [`Not valid JSON: ${error instanceof Error ? error.message : String(error)}`] }
  }

  const entries = Array.isArray(parsed) ? parsed : [parsed]
  const errors: string[] = []

  const connectors = entries
    .map((entry, index) => coerceDraft(entry, index, errors))
    .filter((draft): draft is IxConnectorDraft => draft !== null)

  if (!connectors.length && !errors.length) {
    errors.push('No connector definitions found.')
  }

  return { connectors, errors }
}

/** Registry export for sharing/backup — never contains tokens. */
export function exportConnectorsJson(connectors: IxDynamicConnector[]): string {
  const rows = connectors.map(connector => ({
    id: connector.id,
    label: connector.label,
    url: connector.url,
    transport: connector.transport,
    authHeader: connector.authHeader,
    category: connector.category,
    appIds: connector.appIds,
    bundles: connector.bundles,
    readOnlyTools: connector.readOnlyTools,
    enabled: connector.enabled
  }))

  return JSON.stringify(rows, null, 2)
}
