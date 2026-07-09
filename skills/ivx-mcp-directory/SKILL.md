---
name: ivx-mcp-directory
description: Index of the org's MCP fabric — how the admin-mcp gateway, its meta-tools (admin_list_tools, admin_mcp_directory, admin_call_mcp), dynamic connectors, and the desktop IX Agency Tools tab fit together, plus the full table of all 38 MCP tiles. Start here when unsure which service/tool to use.
version: 1.0.0
metadata:
  hermes:
    tags: [mcp, directory, gateway, admin-mcp, index, tiles]
    related_skills: [ivx-mcp-agents, ivx-mcp-talk-to-people, ivx-mcp-measure-monitor, ivx-mcp-make-content, ivx-mcp-commerce, ivx-mcp-plan-track-work, ivx-mcp-game-ops]
---

# Org MCP directory — how the fabric works

## The architecture in one paragraph

Every service in the engagement stack (email, WhatsApp, voice, social,
CRM, analytics, revenue, KYC, game ops, …) exposes an MCP server. A
central **gateway — admin-mcp at `https://admin-mcp.intelli-verse-x.ai/`**
(Bearer = `ADMIN_MCP_TOKEN`) — knows every downstream server's URL, auth
style, session-handshake quirks, and holds **default tokens** so agents
can call services without handling keys. Roughly half of the servers are
in-cluster only (`*.svc.cluster.local`) and are **unreachable except
through the gateway**. The registry of ~116 admin tiles (38 with MCP
endpoints) is generated from the web frontend's `admin-actions.ts`; the
desktop app's **IX Agency → Tools tab** shows the same tiles from a
bundled snapshot (`mcp-tiles.json`).

## The gateway meta-tools

| Tool | What it does |
|---|---|
| `admin_list_groups` | Tile groups (categories) with counts |
| `admin_list_tools` | Search/filter tiles (`group`, `q`, `scope`, `mcpOnly`) |
| `admin_get_tool` | Full tile record + launch URL |
| `admin_preflight` | Probe tile URLs → ok/down |
| `admin_launch_url` | SSO launch link for a tile |
| `admin_mcp_directory` | Every downstream MCP + auth hints + `hasDefaultToken` |
| `admin_call_mcp` | Fan-out: `tools/list` / `tools/call` on any downstream MCP |

`admin_call_mcp` args: `{ tileId | mcpUrl, method: "tools/list" |
"tools/call", tool?, arguments?, token?, appId? }`. Token precedence:
explicit `token` > per-app connector token (`<id>__<appId>`) > platform
default. `appId` (portal tenant: `quizverse`, `questx`, `intelliverse`,
`contentx`, `kioskx`, `toba`) selects that app's connected account and is
forwarded as a tenancy hint to app-aware MCPs (ga4, gsc, …).
Session-handshake servers (Grafana, Loki, Postiz, QuestX, Content
Factory) are handled transparently.

**Dynamic connectors:** new MCP servers and per-app tokens are registered
through the admin portal (connector requests); the gateway picks them up
via the `admin-mcp-gateway-tokens` secret — `admin_mcp_directory` is
always the live source of truth, this file is a snapshot.

**Gateway tileId ≠ registry tile id for a few servers:** `whatsapp`→`openbsp`,
`stripe-revenue`→`stripe`, `revenuecat-revenue`→`revenuecat`,
`ga4-analytics`→`ga4`, `gsc-search`→`gsc`, `appstore-insights`→`appstore`,
`playstore-insights`→`playstore`, `aws-costs`→`aws`, `dataviz`→`viz`,
`didit-kyc`→`didit`, `veriff-kyc`→`veriff`, `youtube-stats`→`youtube`,
`quests`→`questx`, `nakama-console`→`nakama`, `appsflyer-attribution`→`appsflyer`,
`adjust`→`adjust`, `agent-mcp`→`content-factory`,
`intelliverse-mcp`→`intelliverse`. When in doubt, `admin_mcp_directory`.

## Per-group skills

Deeper playbooks: `ivx-mcp-talk-to-people`, `ivx-mcp-measure-monitor`,
`ivx-mcp-make-content`, `ivx-mcp-commerce`, `ivx-mcp-plan-track-work`,
`ivx-mcp-agents`, `ivx-mcp-game-ops`; per-service:
`ivx-mcp-chatwoot-support`, `ivx-mcp-fonoster-voice`,
`ivx-mcp-postiz-social`, `ivx-mcp-notifuse-email`,
`ivx-mcp-stripe-revenue`, `ivx-mcp-ga4-gsc-analytics`, `ivx-mcp-posthog`,
`ivx-mcp-documenso-contracts`.

## All 38 MCP tiles (generated from admin-mcp/registry.json)

Endpoints marked *(in-cluster)* are only reachable via `admin_call_mcp`.

| Tile id | Group | What it does | MCP endpoint |
|---|---|---|---|
| `admin-mcp` | Agents | The gateway itself: registry, preflight, launch URLs, fan-out | `https://admin-mcp.intelli-verse-x.ai/` |
| `agent-mcp` | Agents | Content Factory agent MCP (pipeline runs, releases, ads, analytics) | `https://agent-mcp.intelli-verse-x.ai/mcp` |
| `gastown` | Agents | Coding crew — assign coding tasks, track work batches | `http://gastown.aicart.svc.cluster.local:8090/` *(in-cluster)* |
| `intelliverse-mcp` | Agents | Platform gateway, ~1300 tools (admin/game/user/payment/kube APIs) | `https://mcp.intelli-verse-x.ai/api/mcp` |
| `documenso` | Commerce | E-signatures & contracts, full document lifecycle | `https://documenso-mcp.intelli-verse-x.ai/` |
| `nakama-console` | Game ops | Player accounts: inspect, wallets, flags, configs | `https://nakama-mcp.intelli-verse-x.ai/` |
| `quests` | Game ops | QuestX rewards economy (~120 tools: brands, quests, redemptions, fraud) | `http://quests-api.quests-economy.svc.cluster.local:3002/mcp` *(in-cluster)* |
| `firecrawl` | Make content | Web scraping/search/crawl/extract (official MCP) | `https://mcp.firecrawl.dev/v2/mcp` |
| `open-seo` | Make content | SEO research: keywords, SERP, domain overview, rank tracker | `https://seo.toba-tech.ai/mcp` |
| `qrstudio` | Make content | QR codes, landing pages, scan analytics (31 tools) | `http://qr-mcp.aicart.svc.cluster.local/` *(in-cluster)* |
| `stitch` | Make content | Google Stitch AI UI design (official MCP; X-Goog-Api-Key auth) | `https://stitch.googleapis.com/mcp` |
| `adjust` | Measure & monitor | Adjust mobile attribution: installs, cost, ROAS, cohorts (read-only) | `http://adjust-mcp.aicart.svc.cluster.local/` *(in-cluster)* |
| `appsflyer-attribution` | Measure & monitor | AppsFlyer official MCP: attribution, ROAS/LTV, SKAN, OneLink | `https://mcp.appsflyer.com/auth/mcp` |
| `appstore-insights` | Measure & monitor | App Store Connect per app-id: reviews, ratings, sales | `http://appstore-mcp.aicart.svc.cluster.local/` *(in-cluster)* |
| `aws-costs` | Measure & monitor | AWS spend by service, forecast, EKS state (read-only) | `http://aws-mcp.aicart.svc.cluster.local/` *(in-cluster)* |
| `dataviz` | Measure & monitor | Render charts/dashboards/HTML/MP4 to hosted URLs | `http://viz-mcp.aicart.svc.cluster.local/` *(in-cluster)* |
| `didit-kyc` | Measure & monitor | Didit KYC/KYB sessions, decisions, verification links | `http://didit-mcp.aicart.svc.cluster.local/` *(in-cluster)* |
| `ga4-analytics` | Measure & monitor | GA4 traffic per app-id: users, sessions, pages, sources, realtime | `http://ga4-mcp.aicart.svc.cluster.local/` *(in-cluster)* |
| `grafana` | Measure & monitor | Official Grafana MCP (65 tools): dashboards, PromQL, LogQL, alerts | `https://grafana-mcp.intelli-verse-x.ai/mcp` |
| `gsc-search` | Measure & monitor | Search Console per app-id: clicks, queries, sitemaps, URL inspection | `http://gsc-mcp.aicart.svc.cluster.local/` *(in-cluster)* |
| `loki` | Measure & monitor | Direct cluster log search (42 tools, no LogQL needed) | `http://loki-mcp.aicart.svc.cluster.local/mcp` *(in-cluster)* |
| `playstore-insights` | Measure & monitor | Play Console per app-id: reviews, IAP, subscriptions, crash/ANR | `http://playstore-mcp.aicart.svc.cluster.local/` *(in-cluster)* |
| `posthog` | Measure & monitor | PostHog official MCP: insights, HogQL, replays, flags, errors | `https://mcp.posthog.com/mcp` |
| `quickbooks` | Measure & monitor | QuickBooks: P&L, balance sheet, cash flow, expenses (read-first) | `http://quickbooks-mcp.aicart.svc.cluster.local/` *(in-cluster)* |
| `revenuecat-revenue` | Measure & monitor | RevenueCat mobile IAP revenue: MRR, subs, customers (read-only) | `http://revenuecat-mcp.aicart.svc.cluster.local/` *(in-cluster)* |
| `stripe-revenue` | Measure & monitor | Stripe money: revenue summary, balance, subs, payouts (read-only) | `http://stripe-mcp.aicart.svc.cluster.local/` *(in-cluster)* |
| `veriff-kyc` | Measure & monitor | Veriff verification by sessionId, PEP/sanctions screening | `http://veriff-mcp.aicart.svc.cluster.local/` *(in-cluster)* |
| `youtube-stats` | Measure & monitor | House YouTube channel stats (read-only, public data) | `http://youtube-mcp.aicart.svc.cluster.local/` *(in-cluster)* |
| `leantime` | Plan & track work | Leantime project plans, tasks, milestones | `https://leantime-mcp.intelli-verse-x.ai/rpc` |
| `n8n` | Plan & track work | n8n workflows: list/inspect, activate/deactivate, executions | `https://n8n-mcp.intelli-verse-x.ai/` |
| `beehiiv` | Talk to people | Newsletters: subscribers, segments, sends | `https://mcp.beehiiv.com/mcp` (OAuth; self-hosted alt `beehiiv-mcp.intelli-verse-x.ai`) |
| `chatwoot` | Talk to people | Shared inbox: customer conversations across channels | `https://chatwoot-mcp.intelli-verse-x.ai/` |
| `fonoster` | Talk to people | VoIP: outbound calls, IVRs, recordings | `https://fonoster-mcp.intelli-verse-x.ai/` |
| `notifuse` | Talk to people | Email & push campaigns, open tracking | `https://notifuse-mcp.intelli-verse-x.ai/mcp` |
| `postiz` | Talk to people | Social post scheduling + analytics (wrapper, org key baked) | `https://postiz-mcp.intelli-verse-x.ai/` |
| `telnyx` | Talk to people | SMS, numbers, balance, message history (wrapper) | `https://telnyx-mcp.intelli-verse-x.ai/` |
| `twenty` | Talk to people | CRM: people, companies, pipeline (meta-tool flow: get_tool_catalog → learn_tools → execute_tool) | `https://crm.intelli-verse-x.ai/mcp` |
| `whatsapp` | Talk to people | WhatsApp Business send/reply (OpenBSP; gateway tileId `openbsp`) | `https://openbsp-mcp.intelli-verse-x.ai/` |

The gateway also fronts servers not on the tile grid (github, slack,
linear, notion, sentry, vercel, supabase, salesforce, paypal, cloudflare,
telnyx, the `ivx-*` platform facets, …) — `admin_mcp_directory` lists
what's actually callable right now.

## Universal cautions

- **Write actions need human approval**: anything that sends (email,
  WhatsApp, SMS, call, social post, contract), mutates (flags, workflows,
  quests, bans, kube restarts), spends (Stitch credits, KYC sessions,
  Gas Town tasks) — show the plan, then act.
- **Never paste tokens into chat.** Defaults are baked at the gateway; if
  auth fails, report which secret needs re-seeding.
- **Don't invent tool names.** Where a tile's tool list isn't documented,
  `admin_call_mcp { tileId, method: "tools/list" }` first.
- 401 = wrong/rotated downstream token or missing scope; connection
  refused on a `svc.cluster.local` URL = you tried direct attach on an
  in-cluster server — use the gateway.
