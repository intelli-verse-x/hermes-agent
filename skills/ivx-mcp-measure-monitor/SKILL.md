---
name: ivx-mcp-measure-monitor
description: The "Measure & monitor" MCP tiles — Grafana/Loki observability, AWS costs, Stripe/RevenueCat/QuickBooks money, GA4/GSC/PostHog/AppsFlyer/Adjust analytics, App Store/Play Store/YouTube fleet data, Didit/Veriff KYC, and the viz renderer. Use for any "how are we doing / what is broken / how much did we make" question.
version: 1.0.0
metadata:
  hermes:
    tags: [mcp, analytics, monitoring, revenue, costs, kyc, observability]
    related_skills: [ivx-mcp-directory, ivx-mcp-stripe-revenue, ivx-mcp-ga4-gsc-analytics, ivx-mcp-posthog]
---

# Measure & monitor — analytics, money, and observability MCPs

## When to use this skill

- Metrics questions: traffic, retention, installs, ROAS, DAU, reviews.
- Money questions: revenue, MRR, P&L, cloud spend, forecast.
- Ops questions: alerts firing, pod logs, error spikes.
- KYC questions: who verified / got declined, mint a verification link.
- Rendering any of the above as a chart/dashboard/video (viz).

Most tiles here are **read-only wrappers with baked credentials** —
no token handling needed when going through the gateway.

## The tiles in this group

Registry group `measure`. Gateway tileId is what `admin_call_mcp` takes.

| Tile id | Gateway tileId | What it does | Key tools / notes |
|---|---|---|---|
| `grafana` | `grafana` | Dashboards, PromQL, LogQL, alert rules (official MCP, 65 tools, session handshake) | `query_prometheus` needs `startTime` AND `endTime` (e.g. `'now'`); Loki via `query_loki_logs` with `datasourceUid: 'loki'`. Viewer SA token baked. |
| `loki` | `loki` | Direct cluster log search (42 tools) | `loki_search_logs` (no LogQL needed), `loki_error_summary`, `loki_query_range`. Mutations need `confirm=true`. In-cluster only. |
| `aws-costs` | `aws` | AWS spend + EKS state (read-only) | `aws_cost_by_service`, `aws_cost_daily`, `aws_cost_forecast`, `aws_eks_list_clusters`, `aws_eks_list_nodegroups`. In-cluster only. |
| `stripe-revenue` | `stripe` | Stripe money (read-only) | `stripe_revenue_summary` (start here), `stripe_balance`, `stripe_list_charges/subscriptions/invoices/payouts/refunds_disputes/customers/products_prices`. In-cluster only. |
| `revenuecat-revenue` | `revenuecat` | Mobile IAP/subscription revenue (read-only) | `revenuecat_list_projects` (start here), `revenuecat_overview_metrics` (MRR/active subs), customers. In-cluster only. |
| `quickbooks` | `quickbooks` | Accounting: P&L, balance sheet, cash flow (read-first) | `qb_profit_and_loss` (start here), `qb_balance_sheet`, `qb_cash_flow`, `qb_expenses_list`, `qb_invoices_list`, `qb_query` (SELECT-only). In-cluster only. |
| `ga4-analytics` | `ga4` | GA4 traffic per app-id | `ga4_list_apps` (start here), `ga4_traffic_summary`, `ga4_top_pages`, `ga4_traffic_sources`, `ga4_events`, `ga4_realtime`. Every tool takes `appId`. In-cluster only. |
| `gsc-search` | `gsc` | Search Console organic per app-id | `gsc_list_sites` (start here), `gsc_search_summary`, `gsc_top_queries`, `gsc_top_pages`, `gsc_sitemaps`, `gsc_inspect_url`. Takes `appId`. In-cluster only. |
| `posthog` | `posthog` | PostHog official MCP: insights, HogQL, replays, flags, errors | Bearer = personal API key (`phx_...`); platform default seeded. |
| `appsflyer-attribution` | `appsflyer` | AppsFlyer official MCP: attribution, ROAS/LTV, SKAN, OneLink | Bearer = AppsFlyer MCP token; default via connector. |
| `adjust` | `adjust` | Adjust attribution (read-only) | `adjust_apps_list` (start here), `adjust_report`, `adjust_cohorts` (`retention_by_network` / `fraud_overview` presets). In-cluster only. |
| `appstore-insights` | `appstore` | App Store Connect per app-id | `appstore_list_apps` (start here), `appstore_app_overview`, `appstore_latest_reviews`, `appstore_ratings_summary`, `appstore_sales_report`. In-cluster only. |
| `playstore-insights` | `playstore` | Play Console per app-id | `playstore_list_apps` (start here), `playstore_latest_reviews`, `playstore_iap_products`, `playstore_subscriptions`, `playstore_crash_anr_rates`. In-cluster only. |
| `youtube-stats` | `youtube` | House YouTube channel stats (read-only, public data) | `youtube_channel_stats` (start here), `youtube_recent_videos`, `youtube_top_videos`, `youtube_video_stats`. In-cluster only. |
| `didit-kyc` | `didit` | Didit KYC/KYB sessions & decisions | `didit_list_sessions` (start here), `didit_session_decision`, `didit_create_session` (mints a link; **uses credits**). In-cluster only. |
| `veriff-kyc` | `veriff` | Veriff verification by sessionId (no list endpoint) | `veriff_session_decision/person/watchlist_screening`, `veriff_create_session`; on failure run `veriff_setup_status`. In-cluster only. |
| `dataviz` | `viz` | Render charts (PNG), dashboards, HTML, MP4 — hosted URLs | `viz_render_image`, `viz_render_dashboard`, `viz_render_html`, `viz_render_video`. Always show the returned URL. In-cluster only. |

Portal-only tiles (no MCP): `langfuse` (LLM traces/cost), `memory-atlas`,
`quizverse-metrics`, `marketx`, `cro-audit`, `competitor-intel`,
`cashback-analytics`, `insights-engine`, `app-dashboard`.

## How to reach them

**Most of these are in-cluster only** (`*.aicart.svc.cluster.local` URLs) —
from outside the cluster the **gateway is the only path**:

```
admin_call_mcp { tileId: "stripe", method: "tools/call",
                 tool: "stripe_revenue_summary", arguments: {} }
```

Gateway: `https://admin-mcp.intelli-verse-x.ai/`, Bearer = `ADMIN_MCP_TOKEN`.
The externally-reachable exceptions can also be attached directly:
`grafana-mcp.intelli-verse-x.ai/mcp`, `mcp.posthog.com/mcp`,
`mcp.appsflyer.com/auth/mcp`.

App-id keyed tiles (`ga4`, `gsc`, `appstore`, `playstore`) take `appId` in
every tool: `quizverse`, `questx`, `intelliverse`, `contentx`, `kioskx`,
`toba`. If an app isn't onboarded, the `*_setup_status` tool returns
step-by-step instructions and `*_onboard_app` saves config in-chat.

## Task recipes

**Weekly revenue snapshot.** `stripe_revenue_summary` +
`revenuecat_overview_metrics` + `qb_profit_and_loss`; compare to previous
period, then render with `viz_render_dashboard` and show the hosted URL.

**"Is something broken?"** grafana: list firing alert rules → loki:
`loki_error_summary` for the last 6h → correlate with the affected
service's own MCP. Recommend one action; don't execute writes.

**Traffic report per app.** `ga4_traffic_summary {appId}` +
`gsc_search_summary {appId}` + `appstore_latest_reviews` /
`playstore_crash_anr_rates` — one table per app-id, flag ±20% swings.

**KYC check on a user.** `didit_list_sessions` filtered by
`vendorData`/status → `didit_session_decision` for details. Only call
`didit_create_session` / `veriff_create_session` with approval (costs credits).

## Cautions

- Almost everything here is read-only; the exceptions that spend money or
  credits (`didit_create_session`, `veriff_create_session`) or mutate
  (Grafana dashboard writes, `loki` mutations with `confirm=true`) need
  explicit user approval.
- Never paste tokens into chat — defaults are baked into the wrappers.
- Gather numbers from the analytics MCPs *first*, then pass them to `viz` —
  the viz tools render what you give them, they don't fetch data.
