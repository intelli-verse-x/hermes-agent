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
 *    Squirrel.Mac (signed macOS), and AppImage (Linux). MSI/deb/rpm/source
 *    installs get the download-page fallback instead of a lying "restarting…".
 *  - pickDownloadUrl / releaseNotesText: map electron-updater's UpdateInfo
 *    into the existing IxUpdateStatus shape used by the status strip + tray.
 *  - pickFallbackUrl: where the Update button sends the user when in-place
 *    install is impossible (official feed → the download landing page, which
 *    offers the right artifact per install kind; custom feeds → the artifact).
 */
import fs from 'node:fs'
import path from 'node:path'

/** Official S3 feed base (electron-builder channel files live here). */
export const DEFAULT_UPDATE_FEED_URL = 'https://intelliverse-x-desktop.s3.amazonaws.com/ix-agency'

/** Public download landing page (CI keeps it in sync with the feed —
 *  .github/workflows/desktop-release.yml publish-download-page job). */
export const DOWNLOAD_PAGE_URL = 'https://intelliverse-x-desktop.s3.amazonaws.com/index.html'

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
 *  `…/latest.json` and trailing slashes are stripped. Multi-brand builds pass
 *  their own brand feed as `defaultFeedUrl` (QuizVerse publishes to its own
 *  S3 prefix); the IX Agency feed stays the fallback default. */
export function normalizeUpdateFeedUrl(configured: string, defaultFeedUrl: string = DEFAULT_UPDATE_FEED_URL): string {
  const raw = String(configured || '').trim()

  if (!raw || LEGACY_FEED_URLS.has(raw)) {
    return defaultFeedUrl
  }

  return raw.replace(/\/latest\.json$/, '').replace(/\/+$/, '')
}

export interface InPlaceSupport {
  supported: boolean
  reason: string
}

/** NSIS installs leave "Uninstall <product>.exe" next to the app binary;
 *  MSI installs don't — that file is the cheapest honest nsis-vs-msi marker. */
function hasNsisUninstaller(execDir: string): boolean {
  try {
    return fs.readdirSync(execDir).some(name => /^uninstall .+\.exe$/i.test(name))
  } catch {
    return false
  }
}

/** Where quitAndInstall genuinely works (electron-updater's own matrix). */
export function inPlaceUpdateSupport(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  execDir: string = path.dirname(process.execPath)
): InPlaceSupport {
  if (platform === 'win32') {
    if (hasNsisUninstaller(execDir)) {
      return { supported: true, reason: 'NSIS in-place update' }
    }

    return { supported: false, reason: 'MSI installs are updated by downloading the new installer' }
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

/** Where the Update button sends the user when in-place install is impossible
 *  or fails (unsigned mac, MSI, deb/rpm): the brand's CI-managed download
 *  landing page for an official brand feed — it always offers the newest
 *  release per install kind — otherwise the platform artifact. Brands without
 *  a landing page (brand.downloadPageUrl empty) always get the direct
 *  artifact, so a QuizVerse user is never sent to the IX Agency page. */
export function pickFallbackUrl(
  feedBase: string,
  artifactUrl: string,
  defaultFeedUrl: string = DEFAULT_UPDATE_FEED_URL,
  downloadPageUrl: string = DOWNLOAD_PAGE_URL
): string {
  return feedBase === defaultFeedUrl && downloadPageUrl ? downloadPageUrl : artifactUrl
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
