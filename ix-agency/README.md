# IX Agency

IX Agency is the Intelliverse X build of the Hermes Agent desktop app: the
stock `apps/desktop` shell rebranded for the org, shipping the `ivx-*` agent
skills, wired to the self-hosted Firecrawl instance for web research, and
reachable over the org VPN (Headscale + Tailscale) when the backend runs
remotely.

This directory holds the org-specific pieces. Everything else is tracked
upstream (`NousResearch/hermes-agent`); keep the fork current with:

```bash
gh repo sync intelli-verse-x/hermes-agent --source NousResearch/hermes-agent --branch main
```

## What is rebranded (and what deliberately is not)

Display identity is IX Agency; internal mechanics stay `Hermes` so the
updater, relaunch, and uninstall flows keep working across upstream syncs:

| Surface | Value |
| --- | --- |
| Window titles, menu bar, About panel, notifications | IX Agency (`APP_NAME` in `apps/desktop/electron/main.ts`) |
| macOS Finder display name (`CFBundleDisplayName`), DMG title | IX Agency |
| Windows Start Menu shortcut, uninstaller display name | IX Agency |
| Installer artifacts | `IX-Agency-<version>-<os>-<arch>.*` |
| Locale strings ("Hermes Desktop") in en/ja/zh/zh-Hant | IX Agency |
| Bundle/executable (`Hermes.app`, `Hermes.exe`), `productName`, `appId` | unchanged — update/uninstall machinery globs these paths |
| References to the Hermes backend/CLI (`hermes update`, "Hermes backend") | unchanged — that is the runtime's real name |

## Build the desktop app

```bash
npm run install:desktop          # from the repo root
cd apps/desktop
npm run dev                      # develop against a local backend
npm run dist:mac                 # or dist:win / dist:linux for installers
```

## Org skills

The five org skills live in `skills/` alongside the bundled ones and are
seeded into `~/.hermes/skills/` automatically by the installer and
`hermes update` (via `tools/skills_sync.py`):

- `ivx-agent-vault` — runtime secrets from Infisical
- `ivx-content-factory` — Content Factory MCP usage
- `ivx-gastown-bridge` — talking to Gas Town from outside the Mayor session
- `ivx-products-tour` — product portfolio inventory
- `ivx-stack-tour` — the 5-layer intelli-verse-x stack

They use the open Agent Skills format (SKILL.md), so the same folders work in
Cursor, Claude Code, Codex, and Goose.

## Web research: self-hosted Firecrawl

Two integration paths, both configured in `config.example.yaml`:

1. Native `web` toolset — set `web.backend: firecrawl` in
   `~/.hermes/config.yaml` and `FIRECRAWL_API_URL` in `~/.hermes/.env`
   (see the repo root `.env.example`). The bundled `plugins/web/firecrawl`
   plugin then routes `web_search` / `web_extract` to the org instance.
2. MCP — the `firecrawl` entry under `mcp_servers` runs the MIT-licensed
   `firecrawl-mcp` server for crawl/deep-research tools.

Do not fork Firecrawl's core into this repo: it is AGPL-3.0. Run it as a
separate service and talk to it over the API, which keeps this fork's
licensing MIT-clean.

## VPN: reaching a remote backend (Headscale + Tailscale)

The desktop app runs a local backend by default and works fully offline.
For a shared org backend (k8s via `intelli-verse-x/hermes-deployment`, or a
VPS), put backend and clients on the org tailnet:

1. Server side — join the backend host to the Headscale coordination
   server with the standard Tailscale client:

   ```bash
   tailscale up --login-server=https://headscale.intelli-verse-x.ai
   ```

2. Backend — pin a session token and serve the dashboard on the tailnet
   interface (never on a public interface):

   ```bash
   # in ~/.hermes/.env on the backend host
   HERMES_DASHBOARD_SESSION_TOKEN=<long-random-token>

   hermes dashboard --host 0.0.0.0 --port 9119 --insecure --tui --no-open
   ```

   `--insecure` here means session-token auth instead of the Nous Portal
   OAuth gate; the tailnet provides the transport security.

3. Desktop — each teammate joins the tailnet with the Tailscale client
   (same `--login-server`), then in IX Agency: Settings -> Gateway ->
   Remote gateway, enter `http://<tailnet-hostname>:9119` and the session
   token.

Headscale ACLs scope which users can reach the backend node. New Hermes
release features may lag on Headscale-hosted setups only where they depend
on Tailscale SaaS extras (Funnel, SAML SSO); nothing in this flow does.
