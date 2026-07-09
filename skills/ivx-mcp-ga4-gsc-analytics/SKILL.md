---
name: ivx-mcp-ga4-gsc-analytics
description: Per-app web traffic (Google Analytics 4) and organic search performance (Search Console) via the app-id-keyed wrapper MCPs — sessions, top pages, traffic sources, clicks, impressions, queries, sitemaps, URL inspection. Use for any traffic or SEO performance question.
version: 1.0.0
metadata:
  hermes:
    tags: [mcp, ga4, gsc, analytics, seo, traffic, search-console]
    related_skills: [ivx-mcp-measure-monitor, ivx-mcp-directory]
---

# GA4 + Search Console — traffic & organic search per app-id

## What they are

Two read-only wrapper MCPs keyed by **app-id** (the portal tenant slug:
`quizverse`, `questx`, `intelliverse`, `contentx`, `kioskx`, `toba`).
Google service-account credentials are baked in — no Google login needed.

| | GA4 | Search Console |
|---|---|---|
| Tile id | `ga4-analytics` | `gsc-search` |
| Gateway tileId | `ga4` | `gsc` |
| Endpoint (in-cluster only) | `http://ga4-mcp.aicart.svc.cluster.local/` | `http://gsc-mcp.aicart.svc.cluster.local/` |

Both are in-cluster only — always go through the gateway
(`admin_call_mcp`).

## Key tools (from the registry)

GA4 — every tool takes `appId`:
`ga4_list_apps` (start here), `ga4_traffic_summary`, `ga4_top_pages`,
`ga4_traffic_sources`, `ga4_events`, `ga4_countries`, `ga4_realtime`.

GSC — every tool takes `appId`:
`gsc_list_sites` (start here), `gsc_search_summary`, `gsc_top_queries`,
`gsc_top_pages`, `gsc_by_country_device`, `gsc_sitemaps`, `gsc_inspect_url`.

Onboarding: if an app isn't wired yet, `ga4_setup_status` /
`gsc_setup_status` return step-by-step instructions, and
`ga4_onboard_app` / `gsc_onboard_app` save the property id / site
in-chat (persists, no restart).

## Worked example — "how is quizverse's SEO trending this month?"

1. `admin_call_mcp { tileId: "gsc", method: "tools/call",
   tool: "gsc_search_summary", arguments: { appId: "quizverse", ... } }`
   — clicks + impressions for the period vs the previous one.
2. `gsc_top_queries { appId: "quizverse" }` — which queries moved.
3. `gsc_top_pages` — which pages earn the clicks.
4. Cross-check demand vs behavior: `ga4_traffic_summary` and
   `ga4_top_pages` with `appId: "quizverse"` (are organic landings
   engaging or bouncing?).
5. Report: headline trend, top 5 winning/losing queries, pages to fix.
   Render a chart via the `viz` tile if the user wants visuals.

## Common failure modes

- **Connection refused on direct attach** — in-cluster only; use the
  gateway.
- **Unknown appId / empty data** — run `ga4_list_apps` / `gsc_list_sites`
  first; if the app is missing, run `*_setup_status` and follow its
  instructions (property/site can be onboarded in-chat).
- **403 from Google** — the baked service account was removed from the GA4
  property or GSC site permissions; re-grant it (the `*_setup_status`
  output names the SA email).
- **GSC data lags ~2 days** — "today's clicks" will read as zero; that's
  Google, not a bug.

## Cautions

Read-only, no approval gates. The only writes are `*_onboard_app`
mappings — harmless, but say what you saved. Never paste service-account
JSON into chat; credentials are baked.
