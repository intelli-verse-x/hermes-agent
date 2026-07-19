import assert from 'node:assert/strict'
import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import test from 'node:test'

import { DesktopStudioBroker, DesktopStudioManager, STUDIO_IPC_CHANNELS } from './studio-manager'

test('Studio IPC is a fixed allowlist without raw passthrough', () => {
  assert.equal(STUDIO_IPC_CHANNELS.length, 6)
  assert.equal(
    STUDIO_IPC_CHANNELS.every(channel => channel.startsWith('hermes:studio:')),
    true
  )
  assert.equal(
    STUDIO_IPC_CHANNELS.some(channel => /raw|exec|shell|approve|secret/i.test(channel)),
    false
  )
})

test('source contract pins the canonical fork and protocol', () => {
  const contract = JSON.parse(
    fs.readFileSync(path.resolve(import.meta.dirname, '../assets/hermes-studio-source.v1.json'), 'utf8')
  )

  assert.equal(contract.repository, 'https://github.com/intelli-verse-x/theia')
  assert.equal(contract.protocolVersion, 1)
  assert.match(contract.productCommit, /^[a-f0-9]{40}$/)
  assert.equal(contract.releaseRequired, true)
  assert.equal(contract.status, 'source-pinned-awaiting-signed-release')
})

test('Studio is optional and managed consent does not install', async () => {
  const manager = new DesktopStudioManager()
  assert.equal(manager.status().state, 'absent')
  assert.equal(manager.status().mode, 'absent')
  assert.deepEqual(manager.managedInstallConsent('0.1.0'), { consented: true, version: '0.1.0' })
  assert.equal(manager.status().state, 'absent')
  await assert.rejects(manager.launch({ workspacePath: process.cwd(), sessionId: 's', windowId: 'w' }), /select/)
})

test('Studio launch requires exact linkage and canonical workspace', async () => {
  const manager = new DesktopStudioManager()
  assert.throws(() => manager.useExternal('relative/editor'), /absolute/)
  await assert.rejects(
    manager.launch({ workspacePath: process.cwd(), sessionId: '', windowId: 'main' }),
    /select|linkage/
  )
})

test('real local broker authenticates and returns linked route status', async () => {
  const workspacePath = process.cwd()
  const expected = { workspacePath, sessionId: 'session-real', windowId: 'window-real' }
  const broker = new DesktopStudioBroker()
  await broker.start(expected)

  try {
    const response = await new Promise<{
      payload: { connected: boolean; identity: { sessionId: string }; trust: string }
    }>((resolve, reject) => {
      const socket = net.createConnection(broker.endpoint)
      socket.setEncoding('utf8')
      socket.once('error', reject)
      socket.once('connect', () => {
        socket.write(
          `${JSON.stringify({
            protocolVersion: 1,
            requestId: 'request-real-0001',
            issuedAt: Date.now(),
            expiresAt: Date.now() + 10_000,
            token: broker.token,
            payload: {
              kind: 'handshake',
              identity: {
                sessionId: expected.sessionId,
                windowId: expected.windowId,
                workspaceCanonicalPath: workspacePath
              }
            }
          })}\n`
        )
      })
      socket.once('data', data => {
        socket.end()
        resolve(JSON.parse(data.toString()))
      })
    })

    assert.equal(response.payload.connected, true)
    assert.equal(response.payload.identity.sessionId, expected.sessionId)
    assert.equal(response.payload.trust, 'restricted')
  } finally {
    broker.stop()
  }
})
