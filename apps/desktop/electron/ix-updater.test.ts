/**
 * Tests for electron/ix-updater.ts — feed URL normalization (legacy Tauri
 * manifest URLs must migrate to the official electron-updater feed), the
 * in-place-support matrix (quitAndInstall must never be promised where it
 * cannot work), and download-URL selection from channel-file entries.
 *
 * Run with: node --test electron/ix-updater.test.ts
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DEFAULT_UPDATE_FEED_URL,
  inPlaceUpdateSupport,
  isLegacyJsonManifest,
  normalizeUpdateFeedUrl,
  pickDownloadUrl,
  releaseNotesText
} from './ix-updater'

test('normalizeUpdateFeedUrl: blank and legacy URLs map to the official feed', () => {
  assert.equal(normalizeUpdateFeedUrl(''), DEFAULT_UPDATE_FEED_URL)
  assert.equal(normalizeUpdateFeedUrl('  '), DEFAULT_UPDATE_FEED_URL)
  assert.equal(
    normalizeUpdateFeedUrl('https://hermes-desktop-updates.s3.amazonaws.com/latest.json'),
    DEFAULT_UPDATE_FEED_URL
  )
  assert.equal(
    normalizeUpdateFeedUrl('https://intelliverse-x-desktop.s3.amazonaws.com/latest.json'),
    DEFAULT_UPDATE_FEED_URL
  )
})

test('normalizeUpdateFeedUrl: strips latest.json and trailing slashes from custom feeds', () => {
  assert.equal(normalizeUpdateFeedUrl('https://example.com/feed/latest.json'), 'https://example.com/feed')
  assert.equal(normalizeUpdateFeedUrl('https://example.com/feed///'), 'https://example.com/feed')
  assert.equal(normalizeUpdateFeedUrl('https://example.com/feed'), 'https://example.com/feed')
})

test('isLegacyJsonManifest: custom .json manifests keep the legacy poller', () => {
  assert.equal(isLegacyJsonManifest('https://example.com/my/latest.json'), true)
  // The known legacy defaults migrate instead of staying on the old poller.
  assert.equal(isLegacyJsonManifest('https://hermes-desktop-updates.s3.amazonaws.com/latest.json'), false)
  assert.equal(isLegacyJsonManifest(DEFAULT_UPDATE_FEED_URL), false)
  assert.equal(isLegacyJsonManifest(''), false)
})

test('inPlaceUpdateSupport: win/mac/AppImage yes; bare linux no', () => {
  assert.equal(inPlaceUpdateSupport('win32', {}).supported, true)
  assert.equal(inPlaceUpdateSupport('darwin', {}).supported, true)
  assert.equal(inPlaceUpdateSupport('linux', { APPIMAGE: '/tmp/IX.AppImage' }).supported, true)
  assert.equal(inPlaceUpdateSupport('linux', {}).supported, false)
})

test('pickDownloadUrl: platform-preferred artifact, resolved against the feed base', () => {
  const files = [{ url: 'IX-Agency-0.18.0.AppImage' }, { url: 'IX-Agency-0.18.0.dmg' }, { url: 'IX-Agency-0.18.0.exe' }]

  assert.equal(pickDownloadUrl(files, 'https://feed.example/ix/', 'darwin'), 'https://feed.example/ix/IX-Agency-0.18.0.dmg')
  assert.equal(pickDownloadUrl(files, 'https://feed.example/ix', 'win32'), 'https://feed.example/ix/IX-Agency-0.18.0.exe')
  assert.equal(pickDownloadUrl(files, 'https://feed.example/ix', 'linux'), 'https://feed.example/ix/IX-Agency-0.18.0.AppImage')
})

test('pickDownloadUrl: absolute URLs pass through; empty list yields empty string', () => {
  assert.equal(
    pickDownloadUrl([{ url: 'https://cdn.example/IX.dmg' }], 'https://feed.example/ix', 'darwin'),
    'https://cdn.example/IX.dmg'
  )
  assert.equal(pickDownloadUrl([], 'https://feed.example/ix', 'darwin'), '')
})

test('releaseNotesText: string, array and garbage forms', () => {
  assert.equal(releaseNotesText('  notes  '), 'notes')
  assert.equal(releaseNotesText([{ note: 'a' }, 'b', { note: '' }]), 'a\nb')
  assert.equal(releaseNotesText(undefined), '')
  assert.equal(releaseNotesText(42), '')
})
