# Hermes Studio Desktop contracts

The actual Hermes Studio product and first-party bridge live in
[`intelli-verse-x/theia`](https://github.com/intelli-verse-x/theia), under
`examples/hermes-studio` and `packages/hermes-bridge`. This package contains
only the matching Hermes Desktop protocol, trust, update, extraction,
supervision, and compatibility contracts.

Hermes Studio is an optional sibling process, not a webview. Hermes retains
model routing, secrets, approvals, and mutation execution.

## Prerequisites

- Node.js 20.19+ or 22.12+
- npm 10+
- native build prerequisites required by Electron/Theia for your OS

Install from repository root:

```sh
npm install
```

Run focused foundation checks:

```sh
npm test --workspace @hermes/studio-contracts
npm run typecheck --workspace @hermes/studio-contracts
npm run verify:resources --workspace @hermes/studio-contracts
```

Build the Desktop contracts:

```sh
npm run build --workspace @hermes/studio-contracts
```

Build/run instructions for the editor product are maintained in the fork's
`doc/HermesStudio.md`. Do not commit `lib/`, `node_modules/`, downloaded
plugins, archives, Electron outputs, or packaged applications.

## Open VSX and offline operation

The fork's default extension registry is Open VSX (`https://open-vsx.org`).
No Microsoft Marketplace API is used.

For offline/local-only development, pre-stage allowed plugins under `plugins/`, block registry access, and expect online extension search to fail visibly. Local-only controls are owned by Hermes; Studio cannot change them.

## Desktop flow

Open the Hermes command palette and choose:

- **Install Hermes Studio…** — records explicit foundation consent but deliberately starts no download yet;
- **Use installed Theia-compatible editor…** — selects an existing executable;
- **Hermes Studio: Chat only** — stops Studio and leaves Hermes available;
- **Open Project in Hermes Studio** — launches/focuses the configured sibling with exact workspace/session/window identity.

See `docs/architecture/adr-001-hermes-studio-theia.md` for boundaries, threats, rollout, and phased implementation.
