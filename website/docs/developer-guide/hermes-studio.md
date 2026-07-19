---
sidebar_position: 12
title: Hermes Studio integration
---

# Hermes Studio integration

Hermes Studio is an optional Eclipse Theia desktop product for project-oriented
work. Hermes Desktop remains the governing application and stays fully usable
when Studio is absent, offline, or broken.

The editor product is built from
[`intelli-verse-x/theia`](https://github.com/intelli-verse-x/theia), not from a
generic npm scaffold:

- upstream base: `3595b053a48a1a4c7171aea0361a25f782140af9`;
- initial downstream product commit:
  `425e874dbd19e85d65046d6daa08cc02f2d9a85d`;
- product: `examples/hermes-studio`;
- first-party bridge: `packages/hermes-bridge`;
- extension registry: Open VSX.

## User choices

The Desktop command palette offers:

1. **Install Hermes Studio…** for a future managed, signed release;
2. **Use installed Theia-compatible editor…** for bring-your-own operation;
3. **Hermes Studio: Chat only** to stop/avoid the editor;
4. **Open Project in Hermes Studio** to launch or focus the exact current
   project/session.

The first managed run never downloads without explicit consent. The disclosure
includes source, EPL-2.0 platform license, download and expanded disk sizes,
network/privacy behavior, and version. At the foundation stage no managed
release exists, so consent does not start a download.

## Governance

Studio receives a short-lived per-launch token and connects over a user-private
Unix-domain socket or Windows named pipe. The handshake binds protocol version,
request ID, expiry, canonical workspace, Hermes session, and Desktop window.
Replay, stale identity, unknown capability, and local-only/cloud conflicts fail
closed.

The editor can submit selected context and observe diagnostics, stream output,
route status, and approval status. It cannot read provider credentials, choose
local versus cloud routing, approve an action, or invoke model shell/file/
computer-use operations directly. Voice submits through the same session and
cannot approve. Untrusted workspaces begin restricted.

Terminal, debug, LSP, git, and worktrees are normal Theia project capabilities.
Any agent-requested mutation through them remains subject to Hermes Desktop's
structured approval broker.

## Releases and rollback

Hermes Desktop pins the downstream source commit in
`apps/desktop/assets/hermes-studio-source.v1.json`. A managed release must add a
signed manifest with platform/architecture artifacts, SHA-256 digest, protocol
compatibility, compressed and expanded sizes, and source provenance. Desktop
stages candidates into an inactive A/B slot, health-checks them, then activates
atomically. A failed launch returns to the previous slot.

No editor archive is stored in `hermes-agent`.

## Documentation publication

This site is built by `npm run build` in `website/` and deployed by
`.github/workflows/deploy-site.yml` to GitHub Pages at
[hermes-agent.nousresearch.com/docs](https://hermes-agent.nousresearch.com/docs/).
The repository defines no S3
bucket/prefix or CloudFront invalidation for documentation; the desktop S3
bucket is exclusively the branded application release feed and must not be used
for docs.
