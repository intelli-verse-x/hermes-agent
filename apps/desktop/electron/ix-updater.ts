/**
 * ix-updater.ts — pure decision helpers for the IX Agency in-place auto-update
 * (electron-updater fed from S3).
 *
 * The desktop app publishes with electron-builder's S3 provider
 * (package.json > build.publish): every `--publish always` build uploads the
 * installers PLUS per-platform channel files (latest.yml / latest-mac.yml /
 * latest-linux.yml) to s3://intelliverse-x-desktop/ix-agency/. At runtime,
 * electron-updater's *generic* provider points at that same HTTPS base and
 * consumes those channel files — no AWS credentials in the app.
 *
 * These helpers stay pure (no electron imports) so the security-relevant
 * decisions are unit-testable with `node --test`:
 *
 *  - normalizeUpdateFeedUrl: users may have a legacy Tauri-shape latest.json
 *    URL persisted in ix-agency.json; map legacy/blank values to the official
 *    feed and strip trailing `/latest.json` so the generic provider gets a
 *    BASE url, never a file.
 *  - isLegacyJsonManifest: a custom `.json` manifest keeps the old
 *    poll-and-open-URL behavior (no fake in-place states for feeds that have
 *    no channel files).
 *  - inPlaceUpdateSupport: quitAndInstall is only honest on NSIS (Windows),
 *    Squirrel.Mac (signed macOS), and AppImage (Linux). deb/rpm/source
 *    installs get the download-URL fallback instead of a lying "restarting…".
 *  - pickDownloadUrl / releaseNotesText: map electron-updater's UpdateInfo
 *    into the existing IxUpdateStatus shape used by the status strip + tray.
 */

/** Official S3 feed base (electron-builder channel files live here). */
export const DEFAULT_UPDATE_FEED_URL = 'https://intelliverse-x-desktop.s3.amazonaws.com/ix-agency'

/** Pre-electron-updater defaults that may be persisted in ix-agency.json. */
const LEGACY_FEED_URLS = new Set([
  'https://hermes-desktop-updates.s3.amazonaws.com/latest.json',
  'https://intelliverse-x-desktop.s3.amazonaws.com/latest.json'
])

/** True when the configured URL is a hand-published JSON manifest (Tauri
 *  shape) rather than an electron-updater channel-file feed. */
export function isLegacyJsonManifest(configured: string): boolean {
  const raw = String(configured || '').trim()

  return raw.endsWith('.json') && !LEGACY_FEED_URLS.has(raw)
}

/** Base URL for the generic provider: legacy/blank → official feed;
 *  `…/latest.json` and trailing slashes are stripped. */
export function normalizeUpdateFeedUrl(configured: string): string {
  const raw = String(configured || '').trim()

  if (!raw || LEGACY_FEED_URLS.has(raw)) {
    return DEFAULT_UPDATE_FEED_URL
  }

  return raw.replace(/\/latest\.json$/, '').replace(/\/+$/, '')
}

export interface InPlaceSupport {
  supported: boolean
  reason: string
}

/** Where quitAndInstall genuinely works (electron-updater's own matrix). */
export function inPlaceUpdateSupport(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env
): InPlaceSupport {
  if (platform === 'win32') {
    return { supported: true, reason: 'NSIS in-place update' }
  }

  if (platform === 'darwin') {
    return { supported: true, reason: 'Squirrel.Mac in-place update (requires a signed build)' }
  }

  if (env.APPIMAGE) {
    return { supported: true, reason: 'AppImage in-place update' }
  }

  return { supported: false, reason: 'deb/rpm/source installs are updated by downloading the new package' }
}

export interface FeedFile {
  url?: string
}

/** Preferred manual-download artifact per platform (fallback when in-place
 *  install is impossible: unsigned mac dev builds, deb/rpm installs, errors). */
export function pickDownloadUrl(
  files: FeedFile[],
  feedBase: string,
  platform: NodeJS.Platform = process.platform
): string {
  const names = files.map(f => String(f?.url ?? '')).filter(Boolean)

  if (names.length === 0) {
    return ''
  }

  const prefer =
    platform === 'darwin'
      ? ['.dmg', '.zip']
      : platform === 'win32'
        ? ['.exe', '.msi']
        : ['.AppImage', '.deb', '.rpm']

  const pick = prefer.map(ext => names.find(n => n.endsWith(ext))).find(Boolean) ?? names[0]

  // Channel-file entries are names relative to the feed base.
  if (/^https?:\/\//.test(pick)) {
    return pick
  }

  return `${feedBase.replace(/\/+$/, '')}/${pick.replace(/^\/+/, '')}`
}

/** electron-updater releaseNotes can be a string or a per-version array. */
export function releaseNotesText(notes: unknown): string {
  if (typeof notes === 'string') {
    return notes.trim()
  }

  if (Array.isArray(notes)) {
    return notes
      .map(n => (typeof n === 'string' ? n : String((n as { note?: unknown })?.note ?? '')))
      .filter(Boolean)
      .join('\n')
      .trim()
  }

  return ''
}
