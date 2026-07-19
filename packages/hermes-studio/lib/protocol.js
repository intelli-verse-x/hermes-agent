import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
export const STUDIO_PROTOCOL_VERSION = 1;
export const STUDIO_TOKEN_TTL_MS = 5 * 60_000;
export const STUDIO_REQUEST_TTL_MS = 30_000;
export const CAPABILITY_REGISTRY = Object.freeze({
    'context.read-selected': { trustedWorkspaceRequired: false, approvalAuthority: false },
    'diagnostics.read': { trustedWorkspaceRequired: false, approvalAuthority: false },
    'prompt.submit': { trustedWorkspaceRequired: false, approvalAuthority: false },
    'prompt.stream': { trustedWorkspaceRequired: false, approvalAuthority: false },
    'route.status': { trustedWorkspaceRequired: false, approvalAuthority: false },
    'workspace-edit.review': { trustedWorkspaceRequired: true, approvalAuthority: false },
    'approval.observe': { trustedWorkspaceRequired: false, approvalAuthority: false },
    health: { trustedWorkspaceRequired: false, approvalAuthority: false }
});
const SECRET_KEY_PATTERN = /(api[-_]?key|secret|credential|authorization|provider[-_]?token)/i;
export function assertNoProviderSecrets(value, trail = '$') {
    if (!value || typeof value !== 'object')
        return;
    for (const [key, child] of Object.entries(value)) {
        if (SECRET_KEY_PATTERN.test(key)) {
            throw new Error(`Provider secret field is forbidden at ${trail}.${key}`);
        }
        assertNoProviderSecrets(child, `${trail}.${key}`);
    }
}
export function capabilitiesForTrust(requested, trust) {
    return requested.filter(capability => {
        const definition = CAPABILITY_REGISTRY[capability];
        return definition && !definition.approvalAuthority && (trust === 'trusted' || !definition.trustedWorkspaceRequired);
    });
}
export function assertRouteAllowed(status) {
    if (status.localOnly && status.route === 'cloud') {
        throw new Error('Cloud routing is forbidden while local-only mode is active');
    }
}
export function assertApprovalEvent(event) {
    if (event.state === 'approved' && event.inputModality === 'voice') {
        throw new Error('Voice input cannot approve actions');
    }
    if (event.state === 'approved' && event.approver !== 'desktop-user') {
        throw new Error('Only the Hermes Desktop approval broker may approve actions');
    }
}
export function canonicalWorkspacePath(input, platform = process.platform) {
    if (!path.isAbsolute(input))
        throw new Error('Workspace path must be absolute');
    const normalized = path.normalize(input);
    if (normalized.includes(`..${path.sep}`))
        throw new Error('Workspace traversal is forbidden');
    return platform === 'win32' ? normalized.toLowerCase() : normalized;
}
export function workspaceId(canonicalPath) {
    return createHash('sha256').update(canonicalPath).digest('hex').slice(0, 32);
}
export function studioEndpoint(userData, launchId, platform = process.platform) {
    if (!/^[a-f0-9-]{16,64}$/i.test(launchId))
        throw new Error('Invalid launch id');
    return platform === 'win32'
        ? `\\\\.\\pipe\\hermes-studio-${launchId}`
        : path.join(userData, 'studio', `${launchId}.sock`);
}
export class LaunchAuthenticator {
    now;
    token = randomBytes(32).toString('base64url');
    expiresAt;
    #seen = new Map();
    constructor(now = Date.now, ttlMs = STUDIO_TOKEN_TTL_MS) {
        this.now = now;
        this.expiresAt = now() + ttlMs;
    }
    verify(handshake) {
        const current = this.now();
        this.prune(current);
        if (handshake.protocolVersion !== STUDIO_PROTOCOL_VERSION)
            throw new Error('Unsupported protocol version');
        if (current > this.expiresAt || current > handshake.expiresAt)
            throw new Error('Handshake expired');
        if (handshake.issuedAt > current + 5_000 || handshake.expiresAt - handshake.issuedAt > STUDIO_REQUEST_TTL_MS) {
            throw new Error('Invalid handshake validity window');
        }
        if (!/^[a-zA-Z0-9_-]{16,128}$/.test(handshake.requestId) || this.#seen.has(handshake.requestId)) {
            throw new Error('Replay or invalid request id');
        }
        const expected = Buffer.from(this.token);
        const supplied = Buffer.from(handshake.token);
        if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied))
            throw new Error('Authentication failed');
        this.#seen.set(handshake.requestId, handshake.expiresAt);
    }
    prune(now) {
        for (const [requestId, expiresAt] of this.#seen) {
            if (expiresAt < now)
                this.#seen.delete(requestId);
        }
    }
}
