# Releasing IX Agency (desktop auto-update from AWS)

How the IX Agency desktop app is versioned, published to S3, and auto-updated
on users' machines — and what CI does for you on every merge.

## TL;DR — how to ship a new version

1. Bump `"version"` in `apps/desktop/package.json` (e.g. `0.17.1` → `0.17.2`).
2. Merge to `main`.

CI (`desktop-auto-release.yml`) notices the version on `main` is newer than
what the S3 feed serves, builds macOS + Windows + Linux with electron-builder,
publishes everything to the feed, verifies the public feed end to end, and
tags the commit `ix-desktop-v<version>`. Public release is fail-closed:
macOS signing/notarization and Windows Authenticode credentials must be
configured before either platform can publish.

Installed apps poll the feed on launch and every 4 hours — the non-blocking
**Update available** button pops up in the IX Agency status strip and the tray;
clicking it downloads, installs, and restarts in place.

Manual alternatives (same build chain, `desktop-release.yml`):

```bash
# tag-driven release (version must match apps/desktop/package.json):
git tag ix-desktop-v0.17.2 && git push origin ix-desktop-v0.17.2
# or run the "desktop-release" workflow from the Actions tab (workflow_dispatch)
```

## The update feed

| What | URL |
|---|---|
| Feed base (configured in-app) | `https://intelliverse-x-desktop.s3.amazonaws.com/ix-agency` |
| macOS channel | `…/ix-agency/latest-mac.yml` |
| Windows channel | `…/ix-agency/latest.yml` |
| Linux channel | `…/ix-agency/latest-linux.yml` |

The app uses `electron-updater`'s **generic provider** against the feed base
(`electron/ix-updater.ts` — `DEFAULT_UPDATE_FEED_URL`). electron-updater
appends the per-platform channel file itself; each channel file lists the
artifact names, sizes, and sha512 hashes that electron-updater downloads and
verifies before installing.

Note: fetching the bare feed base URL in a browser returns a small JSON
pointer document (S3 has no directory listings — before it was seeded, that
URL returned `AccessDenied`, which is cosmetic and never affected the app;
the updater only ever requests the channel files above).

### S3 layout / permissions

- Bucket `intelliverse-x-desktop` (us-east-1), prefix `ix-agency/`.
- Bucket policy allows public `s3:GetObject` on `intelliverse-x-desktop/*`
  (Sid `PublicReadUpdater`); the public-access block keeps
  `BlockPublicPolicy=false` so the policy applies. Uploads stay private to the
  `intelliverse-x-desktop-ci` IAM user (repo secrets
  `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`).
- electron-builder publishes directly (`build.publish` in
  `apps/desktop/package.json`: provider `s3`, path `ix-agency`, `acl: null` —
  the bucket policy, not object ACLs, grants public read).

## What CI runs

| Workflow | Trigger | What it does |
|---|---|---|
| `desktop-auto-release.yml` | every merge to `main` touching `apps/desktop/**` | Compares `package.json` version to the live feed. Same version → no-op. Newer → calls the release chain, then pushes the `ix-desktop-v<version>` tag. |
| `desktop-release.yml` | called by auto-release, or `ix-desktop-v*` tag push, or manual dispatch | 3-OS matrix: typecheck + unit tests, build without publishing, verify signing/notarization or Linux manifest integrity, then upload installers, channel files, and matching trust metadata to S3. The `verify-feed` job checks the public feed end to end. |

The `verify-feed` job runs `apps/desktop/scripts/verify-update-feed.mjs`,
which fails the release if any channel file or artifact is not publicly
fetchable, sizes don't match, the three platforms disagree on version, or the
feed doesn't serve the version just built. Run it locally any time:

```bash
node apps/desktop/scripts/verify-update-feed.mjs
# or pin the expectation:
EXPECT_VERSION=0.17.1 node apps/desktop/scripts/verify-update-feed.mjs
```

## Platform notes

- **Windows (NSIS)** and **Linux AppImage**: true in-place update
  (download → install → restart).
- **macOS**: release requires a Developer ID certificate plus complete Apple
  notarization credentials. CI refuses to publish when either is missing.
- **Windows**: release requires an Authenticode code-signing certificate in
  `WINDOWS_CSC_LINK` / `WINDOWS_CSC_KEY_PASSWORD`. CI refuses to publish an
  unsigned installer. Users must not bypass SmartScreen.
- **Windows MSI / Linux deb/rpm**: no in-place path — the app still checks
  the feed and the update button opens the download page
  (`https://intelliverse-x-desktop.s3.amazonaws.com/index.html`, republished
  by the `publish-download-page` job on every release).

## Troubleshooting

- **`AccessDenied` from an S3 URL**: only the exact object keys exist —
  check you're hitting a real key (e.g. `…/ix-agency/latest-mac.yml`, not a
  "directory"). If a real key 403s, re-check the bucket policy still has
  `PublicReadUpdater` and `BlockPublicPolicy=false`; then run the verify
  script above.
- **Release ran but apps don't offer the update**: confirm the feed serves
  the new version (`curl …/ix-agency/latest-mac.yml`), then remember clients
  poll every 4 h — restart the app to check immediately.
- **Tag build failed with a version mismatch**: the guard requires the
  `ix-desktop-v<version>` tag to equal `apps/desktop/package.json` version —
  bump and re-tag.
