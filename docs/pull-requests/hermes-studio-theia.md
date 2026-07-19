# Hermes Studio (Eclipse Theia) foundation

## Problem

Hermes needs an IDE-grade project surface without embedding an editor in the chat renderer or allowing editor code to bypass Hermes secrets, routing, trust, and approval policy.

## Decision

Consume the existing `intelli-verse-x/theia` fork through coordinated PR
`intelli-verse-x/theia#1`, pinned to product commit
`f0837fa5f3ed11295eb50a454511dceaa647d62b` (upstream base
`3595b053a48a1a4c7171aea0361a25f782140af9`). Launch it as a supervised
sibling connected to one Hermes session over authenticated local IPC. This PR
is stacked on Adaptive Local AI only to consume its route-status contract; it is
a separate follow-up and must not be merged first.

## Architecture

- `intelli-verse-x/theia/examples/hermes-studio`: fork-hosted Theia 1.73
  product using Open VSX.
- `intelli-verse-x/theia/packages/hermes-bridge`: first-party typed
  frontend/backend extension.
- `packages/hermes-studio`: Hermes-side protocol, trust, manifest, extraction,
  and supervision contracts only.
- Protocol v1: handshake, capability negotiation, identity, context, diagnostics, prompt streaming, route disclosure, approval observation, reviewed WorkspaceEdit, reconnect, health.
- Desktop manager: optional/BYO state, exact launch linkage, fixed IPC allowlist, process supervision, crash budget, signed manifest/checksum/extraction contracts.

See ADR-001 for the Mermaid diagram and full responsibility split.

## Security boundaries

Per-launch 256-bit token, request IDs, expiry and replay defense; Unix socket/named pipe only. Provider secrets are schema-forbidden. Unknown capabilities fail closed. Untrusted workspaces cannot request edits. Studio and voice cannot approve. Local-only rejects cloud. The editor has no raw IPC, model shell, policy, credentials, or mutation authority.

## UX

Command palette provides Install, Use installed Theia-compatible editor, Chat only, and Open/Focus Project. Managed installation starts with explicit license/source/network/disk/privacy disclosure and no first-run download. Studio failure never blocks Hermes chat.

## Cross-platform support

Path and endpoint fixtures cover macOS, Windows, and Linux. Managed artifacts are selected by OS/architecture and require HTTPS, signature, checksum, and traversal-safe staging. Studio versions use independent current/previous slots in the next delivery phase.

## Scope

Reviewable cross-repository product and governance foundation, Desktop
manager/IPC, real local broker handshake, fork-hosted extension, tests,
documentation, and non-publishing three-platform CI.

## Out of scope

Editor binaries, publishing, production downloader, Microsoft Marketplace,
remote browser deployment, full agent prompt execution, and WorkspaceEdit
execution. Those require the phase-2 review UI and existing structured approval
broker integration.

## Tests

Locally run on macOS:

- Studio contracts: 9/9 passed; typecheck and resource check passed;
- Desktop manager/source pin/IPC: 5/5 passed, including a real mode-0600
  Unix-socket handshake with exact session/window/workspace identity;
- Adaptive Local AI: 67/67 passed;
- governed voice: 29/29 backend and 17/17 UI tests passed;
- Desktop typecheck and changed-file lint passed;
- IX Agency and QuizVerse production builds and brand-separation checks passed;
- fork bridge dependency graph compiled; bridge lint and 1/1 unit test passed;
- fork Hermes Studio Electron development build passed after the documented
  native ffmpeg rebuild;
- Docusaurus English/Chinese production build passed with pre-existing,
  unrelated broken-link warnings.

CI enforces non-publishing macOS, Windows, and Linux contract/product checks.
Windows and Linux application execution was not locally available.

## Documentation

Hermes docs use Docusaurus and `.github/workflows/deploy-site.yml` to publish
GitHub Pages at `https://hermes-agent.nousresearch.com/docs/`. The Theia fork's
documented process is also GitHub Pages for API docs. Neither repository
defines an S3 documentation bucket/prefix or CloudFront invalidation. The only
discovered S3 path is the unrelated Desktop binary feed
`s3://intelliverse-x-desktop/`; no S3 or CloudFront write was performed.

## Rollout/rollback

Foundation CI does not publish. Phase 2 begins behind an opt-in preference. Managed candidates are staged by signed manifest, health-checked, and activated atomically; failed candidates return to the previous slot. Removing/breaking Studio leaves chat operational.

## Risks

The fork has no signed Hermes Studio release yet, so managed download remains
intentionally unavailable. Theia/Electron dependency weight, extension
compatibility, cross-platform process focus, and protocol drift remain risks.
Coherent source pins, capability negotiation, budgets, explicit health/version
fields, and non-publishing CI reduce them.

## Follow-ups

Production socket/pipe transport, secure persisted preferences, downloader/version slots, context/diagnostics adapters, digest-bound WorkspaceEdit review, accessibility audit, measured runtime budgets, approved Open VSX mirror/offline cache, and signed staged distribution.
