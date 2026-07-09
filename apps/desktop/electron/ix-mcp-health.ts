/**
 * Per-MCP-server health lamps for the IX Agency Tools tab.
 *
 * Every tile gets a live probe with the same semantics as the admin-mcp
 * gateway lamp in ix-status.ts, but per server:
 *
 *   green — tools/list answered with a tool inventory
 *   grey  — reachable but auth is missing/rejected (401/403), or the tile is
 *           only reachable through the gateway and no gateway token is set
 *   red   — unreachable / errored
 *
 * Probe paths:
 *   gateway tiles     → admin_call_mcp {tileId, method:"tools/list"} through
 *                       the admin-mcp gateway (JSON-RPC tools/call). When no
 *                       gateway token is configured, public tiles fall back
 *                       to a direct POST tools/list at their mcpUrl;
 *                       in-cluster tiles report grey (gateway required).
 *   dynamic connectors → the portal's POST /api/portal/connectors/dynamic/test
 *                       (the STORED server-side token is used — it never
 *                       round-trips to the desktop).
 *
 * Pure logic with injected fetch implementations — see ix-mcp-health.test.ts.
 */

export interface IxMcpHealthTarget {
  tileId: string
  /** Direct endpoint, used for the no-gateway-token fallback. */
  mcpUrl?: string
  /** gateway = admin-mcp directory tile; dynamic = portal dynamic connector. */
  kind: 'dynamic' | 'gateway'
}

export interface IxMcpHealthResult {
  tileId: string
  state: 'green' | 'grey' | 'red'
  detail: string
  toolCount?: number
}

export const MCP_PROBE_TIMEOUT_MS = 6000

const AUTH_FAILURE_RE = /\b(401|403|unauthorized|forbidden|auth(entication|orization)? (required|failed)|invalid[_ ]token|missing[_ ]token|no token)\b/i

/** In-cluster endpoints are only reachable through the admin-mcp gateway. */
export function isClusterLocalUrl(mcpUrl: string): boolean {
  try {
    const host = new URL(mcpUrl).hostname

    return host.endsWith('.svc.cluster.local') || host.endsWith('.cluster.local')
  } catch {
    return false
  }
}

function countTools(parsed: unknown): null | number {
  if (Array.isArray(parsed)) {
    return parsed.length
  }

  const tools = (parsed as { tools?: unknown })?.tools

  return Array.isArray(tools) ? tools.length : null
}

function green(tileId: string, toolCount: number, via: string): IxMcpHealthResult {
  return { tileId, state: 'green', toolCount, detail: `${toolCount} tools via ${via}` }
}

/**
 * One JSON-RPC call straight at an MCP endpoint. Handles both plain-JSON and
 * streamable-HTTP (SSE) responses, which official hosted MCPs use.
 */
async function directJsonRpc(
  mcpUrl: string,
  method: string,
  timeoutMs: number,
  fetchImpl: typeof fetch
): Promise<{ result?: unknown; error?: { message?: string }; status: number }> {
  const res = await fetchImpl(mcpUrl, {
    method: 'POST',
    headers: { Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: {} }),
    signal: AbortSignal.timeout(timeoutMs)
  })

  if (!res.ok) {
    return { status: res.status }
  }

  const contentType = res.headers.get('content-type') ?? ''

  if (contentType.includes('text/event-stream')) {
    const text = await res.text()

    const parsed = text
      .split('\n')
      .filter(line => line.startsWith('data:'))
      .map(line => {
        try {
          return JSON.parse(line.slice(5).trim()) as { error?: { message?: string }; result?: unknown }
        } catch {
          return null
        }
      })
      .find(chunk => chunk && (chunk.result !== undefined || chunk.error !== undefined))

    if (!parsed) {
      return { status: res.status, error: { message: 'empty event stream' } }
    }

    return { ...parsed, status: res.status }
  }

  const body = (await res.json()) as { error?: { message?: string }; result?: unknown }

  return { ...body, status: res.status }
}

/** Direct tools/list at a tile's own endpoint (no-gateway-token fallback). */
export async function probeDirectMcp(
  tileId: string,
  mcpUrl: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = MCP_PROBE_TIMEOUT_MS
): Promise<IxMcpHealthResult> {
  try {
    const rpc = await directJsonRpc(mcpUrl, 'tools/list', timeoutMs, fetchImpl)

    if (rpc.status === 401 || rpc.status === 403) {
      return { tileId, state: 'grey', detail: `Auth required (HTTP ${rpc.status}) at ${mcpUrl}` }
    }

    if (rpc.status && (rpc.status < 200 || rpc.status >= 300)) {
      return { tileId, state: 'red', detail: `tools/list returned HTTP ${rpc.status}` }
    }

    if (rpc.error) {
      const message = rpc.error.message || 'MCP error'

      return AUTH_FAILURE_RE.test(message)
        ? { tileId, state: 'grey', detail: `Auth required: ${message}` }
        : { tileId, state: 'red', detail: `tools/list failed: ${message}` }
    }

    const toolCount = countTools(rpc.result)

    if (toolCount === null) {
      return { tileId, state: 'red', detail: 'tools/list answered without a tool inventory' }
    }

    return green(tileId, toolCount, 'direct tools/list')
  } catch (error) {
    return { tileId, state: 'red', detail: `Unreachable: ${error instanceof Error ? error.message : String(error)}` }
  }
}

/** tools/list for one directory tile through admin-mcp's admin_call_mcp. */
export async function probeGatewayTile(
  gatewayUrl: string,
  gatewayToken: string,
  target: { mcpUrl?: string; tileId: string },
  fetchImpl: typeof fetch = fetch,
  timeoutMs = MCP_PROBE_TIMEOUT_MS
): Promise<IxMcpHealthResult> {
  const { tileId } = target

  if (!gatewayToken) {
    if (target.mcpUrl && !isClusterLocalUrl(target.mcpUrl)) {
      return probeDirectMcp(tileId, target.mcpUrl, fetchImpl, timeoutMs)
    }

    return {
      tileId,
      state: 'grey',
      detail: 'Reachable only through the admin-mcp gateway — configure the gateway token in Connect'
    }
  }

  try {
    const res = await fetchImpl(gatewayUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${gatewayToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'admin_call_mcp', arguments: { tileId, method: 'tools/list' } }
      }),
      signal: AbortSignal.timeout(timeoutMs)
    })

    if (res.status === 401 || res.status === 403) {
      return { tileId, state: 'grey', detail: `Gateway token rejected (HTTP ${res.status})` }
    }

    if (!res.ok) {
      return { tileId, state: 'red', detail: `Gateway returned HTTP ${res.status}` }
    }

    const body = (await res.json()) as {
      error?: { message?: string }
      result?: { content?: { text?: string; type?: string }[]; isError?: boolean }
    }

    if (body.error) {
      return { tileId, state: 'red', detail: `Gateway RPC error: ${body.error.message ?? 'unknown'}` }
    }

    const text = body.result?.content?.find(chunk => chunk?.type === 'text')?.text ?? ''

    if (body.result?.isError) {
      const message = text || 'admin_call_mcp failed'

      return AUTH_FAILURE_RE.test(message)
        ? { tileId, state: 'grey', detail: `Auth required at the tile: ${message.slice(0, 200)}` }
        : { tileId, state: 'red', detail: message.slice(0, 200) }
    }

    let parsed: unknown

    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = null
    }

    const toolCount = countTools(parsed)

    if (toolCount === null) {
      return { tileId, state: 'red', detail: 'Gateway answered without a tool inventory' }
    }

    return green(tileId, toolCount, 'admin_call_mcp')
  } catch (error) {
    return { tileId, state: 'red', detail: `Unreachable: ${error instanceof Error ? error.message : String(error)}` }
  }
}

/**
 * One dynamic connector through the portal's server-side probe (the stored
 * token stays server-side). `portalFetch` must carry the OTP session cookies.
 */
export async function probeDynamicConnector(
  portalUrl: string,
  connectorId: string,
  portalFetch: typeof fetch,
  timeoutMs = MCP_PROBE_TIMEOUT_MS
): Promise<IxMcpHealthResult> {
  const tileId = connectorId

  try {
    const res = await portalFetch(new URL('/api/portal/connectors/dynamic/test', portalUrl).toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: connectorId }),
      signal: AbortSignal.timeout(timeoutMs)
    })

    if (res.status === 401 || res.status === 403) {
      return { tileId, state: 'grey', detail: `Portal probe needs a super-admin session (HTTP ${res.status})` }
    }

    const body = (await res.json().catch(() => null)) as null | {
      message?: string
      ok?: boolean
      toolCount?: number
    }

    if (body?.ok) {
      return green(tileId, typeof body.toolCount === 'number' ? body.toolCount : 0, 'portal probe')
    }

    const message = body?.message || `Probe failed (HTTP ${res.status})`

    return AUTH_FAILURE_RE.test(message)
      ? { tileId, state: 'grey', detail: `Auth required at the endpoint: ${message.slice(0, 200)}` }
      : { tileId, state: 'red', detail: message.slice(0, 200) }
  } catch (error) {
    return {
      tileId,
      state: 'red',
      detail: `Portal unreachable: ${error instanceof Error ? error.message : String(error)}`
    }
  }
}

export interface IxMcpHealthOptions {
  gatewayUrl: string
  gatewayToken: string
  portalUrl: string
  /** Plain fetch for gateway/direct probes. */
  fetchImpl?: typeof fetch
  /** Cookie-jar fetch (portal OTP session) for dynamic-connector probes. */
  portalFetch?: typeof fetch
  timeoutMs?: number
}

/** Probe every target concurrently; a failed probe is a red result, never a throw. */
export async function probeMcpHealth(
  targets: IxMcpHealthTarget[],
  options: IxMcpHealthOptions
): Promise<IxMcpHealthResult[]> {
  const fetchImpl = options.fetchImpl ?? fetch
  const portalFetch = options.portalFetch ?? fetchImpl
  const timeoutMs = options.timeoutMs ?? MCP_PROBE_TIMEOUT_MS

  return Promise.all(
    targets.map(target =>
      target.kind === 'dynamic'
        ? probeDynamicConnector(options.portalUrl, target.tileId, portalFetch, timeoutMs)
        : probeGatewayTile(options.gatewayUrl, options.gatewayToken, target, fetchImpl, timeoutMs)
    )
  )
}
