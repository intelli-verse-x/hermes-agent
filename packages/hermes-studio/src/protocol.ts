import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import path from 'node:path'

export const STUDIO_PROTOCOL_VERSION = 1 as const
export const STUDIO_TOKEN_TTL_MS = 5 * 60_000
export const STUDIO_REQUEST_TTL_MS = 30_000

export type StudioCapability =
  | 'context.read-selected'
  | 'diagnostics.read'
  | 'prompt.submit'
  | 'prompt.stream'
  | 'route.status'
  | 'workspace-edit.review'
  | 'approval.observe'
  | 'health'

export type StudioRoute = 'cloud' | 'local' | 'offline'
export type WorkspaceTrust = 'restricted' | 'trusted'
export type InputModality = 'text' | 'voice'

export interface StudioIdentity {
  desktopInstanceId: string
  sessionId: string
  workspaceCanonicalPath: string
  workspaceId: string
  windowId: string
}

export interface StudioHandshake {
  kind: 'handshake'
  protocolVersion: typeof STUDIO_PROTOCOL_VERSION
  requestId: string
  issuedAt: number
  expiresAt: number
  token: string
  identity: StudioIdentity
  requestedCapabilities: StudioCapability[]
}

export interface StudioHandshakeAck {
  kind: 'handshake-ack'
  protocolVersion: typeof STUDIO_PROTOCOL_VERSION
  requestId: string
  grantedCapabilities: StudioCapability[]
  restrictedReasons: string[]
  trust: WorkspaceTrust
}

export interface StudioRouteStatus {
  kind: 'route-status'
  route: StudioRoute
  localOnly: boolean
  providerLabel?: string
  offlineReason?: string
}

export interface StudioSelectedContext {
  kind: 'selected-context'
  uri: string
  languageId: string
  startLine: number
  endLine: number
  text: string
  truncated: boolean
}

export interface StudioDiagnostic {
  uri: string
  severity: 'error' | 'warning' | 'information' | 'hint'
  message: string
  source?: string
  startLine: number
  endLine: number
}

export interface StudioPromptSubmit {
  kind: 'prompt-submit'
  text: string
  modality: InputModality
  context?: StudioSelectedContext
  diagnostics?: StudioDiagnostic[]
}

export interface StudioPromptEvent {
  kind: 'prompt-event'
  streamId: string
  event: 'accepted' | 'delta' | 'route' | 'approval-required' | 'done' | 'error'
  text?: string
  route?: StudioRouteStatus
  approval?: StudioApprovalEvent
}

export interface StudioApprovalEvent {
  approvalId: string
  state: 'pending' | 'approved' | 'denied' | 'expired'
  summary: string
  approver: 'desktop-user' | 'none'
  inputModality: InputModality
}

export interface StudioWorkspaceEdit {
  kind: 'workspace-edit'
  editId: string
  reviewDigest: string
  operations: Array<
    | { type: 'create'; uri: string }
    | { type: 'delete'; uri: string }
    | { type: 'rename'; oldUri: string; newUri: string }
    | { type: 'text'; uri: string; startLine: number; endLine: number; newText: string }
  >
}

export interface StudioEnvelope<T = unknown> {
  protocolVersion: typeof STUDIO_PROTOCOL_VERSION
  requestId: string
  issuedAt: number
  expiresAt: number
  sessionId: string
  payload: T
}

export interface StudioHealth {
  kind: 'health'
  state: 'ready' | 'degraded' | 'stopping'
  version: string
  protocolVersion: typeof STUDIO_PROTOCOL_VERSION
  activeSessionId: string
}

export const CAPABILITY_REGISTRY: Readonly<Record<StudioCapability, {
  trustedWorkspaceRequired: boolean
  approvalAuthority: boolean
}>> = Object.freeze({
  'context.read-selected': { trustedWorkspaceRequired: false, approvalAuthority: false },
  'diagnostics.read': { trustedWorkspaceRequired: false, approvalAuthority: false },
  'prompt.submit': { trustedWorkspaceRequired: false, approvalAuthority: false },
  'prompt.stream': { trustedWorkspaceRequired: false, approvalAuthority: false },
  'route.status': { trustedWorkspaceRequired: false, approvalAuthority: false },
  'workspace-edit.review': { trustedWorkspaceRequired: true, approvalAuthority: false },
  'approval.observe': { trustedWorkspaceRequired: false, approvalAuthority: false },
  health: { trustedWorkspaceRequired: false, approvalAuthority: false }
})

const SECRET_KEY_PATTERN = /(api[-_]?key|secret|credential|authorization|provider[-_]?token)/i

export function assertNoProviderSecrets(value: unknown, trail = '$'): void {
  if (!value || typeof value !== 'object') return
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEY_PATTERN.test(key)) {
      throw new Error(`Provider secret field is forbidden at ${trail}.${key}`)
    }
    assertNoProviderSecrets(child, `${trail}.${key}`)
  }
}

export function capabilitiesForTrust(requested: StudioCapability[], trust: WorkspaceTrust): StudioCapability[] {
  return requested.filter(capability => {
    const definition = CAPABILITY_REGISTRY[capability]
    return definition && !definition.approvalAuthority && (trust === 'trusted' || !definition.trustedWorkspaceRequired)
  })
}

export function assertRouteAllowed(status: StudioRouteStatus): void {
  if (status.localOnly && status.route === 'cloud') {
    throw new Error('Cloud routing is forbidden while local-only mode is active')
  }
}

export function assertApprovalEvent(event: StudioApprovalEvent): void {
  if (event.state === 'approved' && event.inputModality === 'voice') {
    throw new Error('Voice input cannot approve actions')
  }
  if (event.state === 'approved' && event.approver !== 'desktop-user') {
    throw new Error('Only the Hermes Desktop approval broker may approve actions')
  }
}

export function canonicalWorkspacePath(input: string, platform: NodeJS.Platform = process.platform): string {
  const pathApi = platform === 'win32' ? path.win32 : path.posix
  if (!pathApi.isAbsolute(input)) throw new Error('Workspace path must be absolute')
  const normalized = pathApi.normalize(input)
  if (normalized.includes(`..${pathApi.sep}`)) throw new Error('Workspace traversal is forbidden')
  return platform === 'win32' ? normalized.toLowerCase() : normalized
}

export function workspaceId(canonicalPath: string): string {
  return createHash('sha256').update(canonicalPath).digest('hex').slice(0, 32)
}

export function studioEndpoint(userData: string, launchId: string, platform: NodeJS.Platform = process.platform): string {
  if (!/^[a-f0-9-]{16,64}$/i.test(launchId)) throw new Error('Invalid launch id')
  return platform === 'win32'
    ? `\\\\.\\pipe\\hermes-studio-${launchId}`
    : path.join(userData, 'studio', `${launchId}.sock`)
}

export class LaunchAuthenticator {
  readonly token = randomBytes(32).toString('base64url')
  readonly expiresAt: number
  readonly #seen = new Map<string, number>()

  constructor(readonly now: () => number = Date.now, ttlMs = STUDIO_TOKEN_TTL_MS) {
    this.expiresAt = now() + ttlMs
  }

  verify(handshake: StudioHandshake): void {
    const current = this.now()
    this.prune(current)
    if (handshake.protocolVersion !== STUDIO_PROTOCOL_VERSION) throw new Error('Unsupported protocol version')
    if (current > this.expiresAt || current > handshake.expiresAt) throw new Error('Handshake expired')
    if (handshake.issuedAt > current + 5_000 || handshake.expiresAt - handshake.issuedAt > STUDIO_REQUEST_TTL_MS) {
      throw new Error('Invalid handshake validity window')
    }
    if (!/^[a-zA-Z0-9_-]{16,128}$/.test(handshake.requestId) || this.#seen.has(handshake.requestId)) {
      throw new Error('Replay or invalid request id')
    }
    const expected = Buffer.from(this.token)
    const supplied = Buffer.from(handshake.token)
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) throw new Error('Authentication failed')
    this.#seen.set(handshake.requestId, handshake.expiresAt)
  }

  private prune(now: number): void {
    for (const [requestId, expiresAt] of this.#seen) {
      if (expiresAt < now) this.#seen.delete(requestId)
    }
  }
}
