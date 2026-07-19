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
  assert.equal(contract.productCommit, 'f9e91c82552ab11c2af969d7cff16f4efd7ba78a')
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

test('real broker handles context prompt and reconnect after authentication', async () => {
  const workspacePath = process.cwd()
  const expected = { workspacePath, sessionId: 'session-real', windowId: 'window-real' }
  const broker = new DesktopStudioBroker()
  await broker.start(expected)

  const handshake = (requestId: string) => ({
    protocolVersion: 1,
    requestId,
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
  })

  try {
    const responses = await new Promise<Array<{ payload: Record<string, unknown> }>>((resolve, reject) => {
      const socket = net.createConnection(broker.endpoint)
      const received: Array<{ payload: Record<string, unknown> }> = []
      let buffer = ''
      socket.setEncoding('utf8')
      socket.once('error', reject)
      socket.once('connect', () => {
        socket.write(`${JSON.stringify(handshake('request-real-0001'))}\n`)
      })
      socket.on('data', data => {
        buffer += data.toString()

        for (;;) {
          const newline = buffer.indexOf('\n')

          if (newline < 0) {break}
          received.push(JSON.parse(buffer.slice(0, newline)))
          buffer = buffer.slice(newline + 1)

          if (received.length === 1) {
            socket.write(`${JSON.stringify({
              protocolVersion: 1,
              requestId: 'request-real-0002',
              issuedAt: Date.now(),
              expiresAt: Date.now() + 10_000,
              payload: {
                kind: 'prompt-submit',
                modality: 'text',
                text: 'Review this selection',
                context: { uri: 'file:///workspace/a.ts', text: 'const answer = 42' }
              }
            })}\n`)
          } else if (received.length === 2) {
            socket.write(`${JSON.stringify({
              protocolVersion: 1,
              requestId: 'request-real-0004',
              issuedAt: Date.now(),
              expiresAt: Date.now() + 10_000,
              payload: {
                kind: 'workspace-edit-review',
                editId: 'edit-1',
                reviewDigest: 'digest',
                accepted: true
              }
            })}\n`)
          } else {
            socket.end()
            resolve(received)
          }
        }
      })
    })

    assert.equal(responses[0].payload.connected, true)
    assert.equal((responses[0].payload.identity as { sessionId: string }).sessionId, expected.sessionId)
    assert.equal(responses[0].payload.trust, 'restricted')
    assert.equal(responses[1].payload.type, 'accepted')
    assert.equal(responses[2].payload.type, 'error')

    const reconnect = await new Promise<{ payload: { connected: boolean } }>((resolve, reject) => {
      const socket = net.createConnection(broker.endpoint)
      socket.setEncoding('utf8')
      socket.once('error', reject)
      socket.once('connect', () => socket.write(`${JSON.stringify(handshake('request-real-0003'))}\n`))
      socket.once('data', data => {
        socket.end()
        resolve(JSON.parse(data.toString()))
      })
    })

    assert.equal(reconnect.payload.connected, true)
  } finally {
    broker.stop()
  }
})
