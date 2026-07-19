import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { generateKeyPairSync, sign } from 'node:crypto'
import test from 'node:test'

import {
  CAPABILITY_REGISTRY,
  LaunchAuthenticator,
  STUDIO_PROTOCOL_VERSION,
  assertApprovalEvent,
  assertNoProviderSecrets,
  assertRouteAllowed,
  canonicalWorkspacePath,
  capabilitiesForTrust,
  studioEndpoint,
  workspaceId,
  type StudioHandshake
} from '../src/protocol.js'
import {
  CrashBudget,
  DEFAULT_STUDIO_PREFERENCES,
  HermesStudioManager,
  StudioProcessSupervisor,
  artifactForRuntime,
  assertSafeArchiveEntries,
  requireDownloadConsent,
  verifyArtifact,
  verifyManifest,
  type StudioManifest
} from '../src/manager.js'

const identity = {
  desktopInstanceId: 'desktop-1',
  sessionId: 'session-1',
  workspaceCanonicalPath: '/tmp/work',
  workspaceId: workspaceId('/tmp/work'),
  windowId: 'window-1'
}

function handshake(auth: LaunchAuthenticator, now: number, requestId = 'request_id_000001'): StudioHandshake {
  return {
    kind: 'handshake',
    protocolVersion: STUDIO_PROTOCOL_VERSION,
    requestId,
    issuedAt: now,
    expiresAt: now + 10_000,
    token: auth.token,
    identity,
    requestedCapabilities: ['prompt.submit', 'workspace-edit.review']
  }
}

test('per-launch authentication rejects bad tokens, replay, and expiry', () => {
  let now = 1_000
  const auth = new LaunchAuthenticator(() => now, 60_000)
  auth.verify(handshake(auth, now))
  assert.throws(() => auth.verify(handshake(auth, now)), /Replay/)
  assert.throws(() => auth.verify({ ...handshake(auth, now, 'request_id_000002'), token: 'x'.repeat(43) }), /Authentication/)
  now += 70_000
  assert.throws(() => auth.verify(handshake(auth, now, 'request_id_000003')), /expired/)
})

test('untrusted workspaces fail closed and extension has no approval authority', () => {
  assert.deepEqual(capabilitiesForTrust(['prompt.submit', 'workspace-edit.review'], 'restricted'), ['prompt.submit'])
  assert.equal(Object.values(CAPABILITY_REGISTRY).some(value => value.approvalAuthority), false)
})

test('provider-secret shaped fields are rejected recursively', () => {
  assert.doesNotThrow(() => assertNoProviderSecrets({ route: 'local', tokenCount: 4 }))
  assert.throws(() => assertNoProviderSecrets({ nested: { providerToken: 'secret' } }), /forbidden/)
})

test('local-only route disclosure rejects cloud and voice cannot approve', () => {
  assert.throws(() => assertRouteAllowed({ kind: 'route-status', route: 'cloud', localOnly: true }), /forbidden/)
  assert.doesNotThrow(() => assertRouteAllowed({ kind: 'route-status', route: 'local', localOnly: true }))
  assert.throws(
    () => assertApprovalEvent({ approvalId: 'a', state: 'approved', summary: 'edit', approver: 'desktop-user', inputModality: 'voice' }),
    /Voice/
  )
})

test('canonical workspace and endpoint fixtures cover three platforms', () => {
  assert.equal(canonicalWorkspacePath('/Users/me/Project', 'darwin'), '/Users/me/Project')
  assert.equal(canonicalWorkspacePath('/home/me/project', 'linux'), '/home/me/project')
  assert.equal(canonicalWorkspacePath('C:\\Users\\Me\\Project', 'win32'), 'c:\\users\\me\\project')
  assert.match(studioEndpoint('/tmp/hermes', '12345678-1234-1234', 'darwin'), /\.sock$/)
  assert.match(studioEndpoint('C:\\Data', '12345678-1234-1234', 'win32'), /^\\\\\.\\pipe\\/)
  assert.throws(() => canonicalWorkspacePath('relative/path'), /absolute/)
})

test('signed manifest, hash, runtime fixture, and traversal contracts reject tampering', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const unsigned = {
    schemaVersion: 1,
    product: 'hermes-studio',
    version: '0.1.0',
    publishedAt: '2026-07-18T00:00:00Z',
    artifacts: [{
      platform: 'linux',
      arch: 'x64',
      url: 'https://downloads.example.test/studio.tar.gz',
      sha256: 'a'.repeat(64),
      size: 123,
      format: 'tar.gz'
    }],
    keyId: 'release-1'
  } as const
  const signature = sign(null, Buffer.from(JSON.stringify(unsigned)), privateKey).toString('base64')
  const manifest = { ...unsigned, signature } as StudioManifest
  verifyManifest(manifest, publicKey.export({ format: 'pem', type: 'spki' }).toString())
  assert.throws(() => verifyManifest({ ...manifest, version: '9.9.9' }, publicKey.export({ format: 'pem', type: 'spki' }).toString()), /invalid/)
  assert.throws(() => verifyArtifact(Buffer.from('wrong'), 'a'.repeat(64)), /checksum/)
  assert.equal(artifactForRuntime(manifest, 'linux', 'x64').format, 'tar.gz')
  assert.throws(() => assertSafeArchiveEntries(['../../escape']), /Unsafe/)
  assert.throws(() => assertSafeArchiveEntries(['C:\\escape']), /Unsafe/)
})

test('first run never downloads without version-specific consent', () => {
  assert.throws(() => requireDownloadConsent(DEFAULT_STUDIO_PREFERENCES, '0.1.0'), /consent/)
  assert.doesNotThrow(() =>
    requireDownloadConsent({ mode: 'managed', externalExecutable: null, downloadConsentVersion: '0.1.0' }, '0.1.0')
  )
})

test('supervisor enforces restart budget and exact session/window linkage', () => {
  let now = 100
  const budget = new CrashBudget(2, 1_000, () => now)
  assert.equal(budget.recordCrash(), true)
  assert.equal(budget.recordCrash(), true)
  assert.equal(budget.recordCrash(), false)
  now += 2_000
  assert.equal(budget.recordCrash(), true)

  class FakeChild extends EventEmitter {
    pid = 42
    killed = false
    kill() { this.killed = true; return true }
  }
  const child = new FakeChild()
  const supervisor = new StudioProcessSupervisor(() => child as never)
  const manager = new HermesStudioManager('/tmp/hermes', supervisor, {
    mode: 'bring-your-own',
    externalExecutable: '/opt/theia',
    downloadConsentVersion: null
  })
  const status = manager.launch(
    { workspacePath: '/tmp/work', sessionId: 'session-1', windowId: 'window-1' },
    '/opt/theia',
    '0.1.0'
  )
  assert.equal(status.sessionId, 'session-1')
  assert.equal(status.windowId, 'window-1')
  assert.equal(status.workspaceId, workspaceId('/tmp/work'))
  assert.throws(() => manager.launch({ workspacePath: '/tmp/work', sessionId: '', windowId: 'w' }, '/opt/theia', '0.1.0'), /identity/)
})

test('Desktop contracts remain product-neutral and pin the downstream fork', async () => {
  const packageMetadata = await import('../package.json', { with: { type: 'json' } })
  assert.equal(packageMetadata.default.name, '@hermes/studio-contracts')
  assert.match(packageMetadata.default.description, /intelli-verse-x\/theia/)
  assert.equal(JSON.stringify(packageMetadata.default).includes('Marketplace'), false)
})
