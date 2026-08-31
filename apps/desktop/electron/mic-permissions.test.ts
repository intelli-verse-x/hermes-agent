import assert from 'node:assert/strict'
import test from 'node:test'

import { isApprovedMicrophoneRequestContext, isApprovedRendererUrl, isAudioOnlyPermission } from './mic-permissions'

const packaged = {
  packagedRendererPaths: ['file:///Applications/IVX.app/Contents/Resources/app.asar/dist/index.html']
}

test('packaged microphone access accepts only the canonical renderer file', () => {
  assert.equal(
    isApprovedRendererUrl('file:///Applications/IVX.app/Contents/Resources/app.asar/dist/index.html#/chat', packaged),
    true
  )
  assert.equal(isApprovedRendererUrl('file:///tmp/attacker/index.html', packaged), false)
  assert.equal(isApprovedRendererUrl('file:///etc/passwd', packaged), false)
  assert.equal(isApprovedRendererUrl('https://example.com', packaged), false)
  assert.equal(isApprovedRendererUrl('data:text/html,test', packaged), false)
})

test('development microphone access accepts the configured origin only', () => {
  const development = { developmentOrigin: 'http://127.0.0.1:5173' }

  assert.equal(isApprovedRendererUrl('http://127.0.0.1:5173/chat', development), true)
  assert.equal(isApprovedRendererUrl('http://localhost:5173', development), false)
  assert.equal(isApprovedRendererUrl('http://127.0.0.1:5174', development), false)
  assert.equal(isApprovedRendererUrl('http://192.168.1.20:5173', development), false)
  assert.equal(isApprovedRendererUrl('https://example.com', development), false)
})

test('permission checks accept audio-only requests and reject video', () => {
  assert.equal(isAudioOnlyPermission('media', { mediaTypes: [] }), true)
  assert.equal(isAudioOnlyPermission('audioCapture'), true)
  assert.equal(isAudioOnlyPermission('media', { mediaTypes: ['audio'] }), true)
  assert.equal(isAudioOnlyPermission('media', { mediaTypes: ['audio', 'video'] }), false)
  assert.equal(isAudioOnlyPermission('media', { mediaType: 'video' }), false)
  assert.equal(isAudioOnlyPermission('camera'), false)
})

test('microphone request context rejects non-app contents and unexpected frames', () => {
  const url = packaged.packagedRendererPaths[0]

  const base = {
    details: { isMainFrame: true, mediaTypes: ['audio'] },
    hasApprovedWindow: true,
    pageUrl: url,
    permission: 'media',
    requestingUrl: url,
    trustedPreload: true
  }

  assert.equal(isApprovedMicrophoneRequestContext(base, packaged), true)
  assert.equal(isApprovedMicrophoneRequestContext({ ...base, hasApprovedWindow: false }, packaged), false)
  assert.equal(isApprovedMicrophoneRequestContext({ ...base, trustedPreload: false }, packaged), false)
  assert.equal(
    isApprovedMicrophoneRequestContext({ ...base, details: { ...base.details, isMainFrame: false } }, packaged),
    false
  )
  assert.equal(
    isApprovedMicrophoneRequestContext({ ...base, requestingUrl: 'file:///tmp/attacker.html' }, packaged),
    false
  )
})
