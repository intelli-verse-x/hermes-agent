---
name: ivx-mcp-stripe-revenue
description: Answer "how much money came in" from Stripe — balance, revenue summary with fees/refunds, charges, subscriptions, invoices, payouts, disputes — via the read-only Stripe wrapper MCP. Pair with RevenueCat for mobile IAP revenue.
version: 1.0.0
metadata:
  hermes:
    tags: [mcp, stripe, revenue, payments, subscriptions, invoices, mrr]
    related_skills: [ivx-mcp-measure-monitor, ivx-mcp-directory]
---

# Stripe — payments revenue (read-only)

## What it is

A **read-only wrapper MCP** over the org's live Stripe account. It cannot
create charges, refunds, or products — reporting only, which makes it safe
to call freely.

- Tile id: `stripe-revenue` (group "Measure & monitor")
- MCP endpoint: `http://stripe-mcp.aicart.svc.cluster.local/` —
  **in-cluster only**, so from anywhere outside the cluster use the
  gateway: `admin_call_mcp { tileId: "stripe" }`.
- Auth: live secret key baked into the pod — no token needed.

## Key tools (from the registry)

| Tool | What it does |
|---|---|
| `stripe_revenue_summary` | Start here — revenue with fees and refunds for a period |
| `stripe_balance` | Current available/pending balance |
| `stripe_list_charges` | Recent charges |
| `stripe_list_subscriptions` | Active/canceled subscriptions |
| `stripe_list_invoices` | Invoices |
| `stripe_list_payouts` | Payouts to the bank |
| `stripe_list_refunds_disputes` | Refunds and disputes |
| `stripe_list_customers` | Customers |
| `stripe_list_products_prices` | Product & price catalog |

## Worked example — "how did we do this month, and are there any disputes?"

1. `admin_call_mcp { tileId: "stripe", method: "tools/call",
   tool: "stripe_revenue_summary", arguments: { ...period... } }` — check
   the tool's schema via `tools/list` for the exact period argument names.
2. `stripe_list_refunds_disputes` for the same window.
3. Optionally `stripe_list_payouts` to show what actually reached the bank.
4. Report: gross → fees → refunds → net, dispute count with amounts, and a
   period-over-period comparison if the user asked for a trend.
5. For a full picture add mobile: `admin_call_mcp { tileId: "revenuecat",
   tool: "revenuecat_overview_metrics" }` (MRR, active subs) — Stripe
   doesn't see app-store IAP.

## Common failure modes

- **Connection refused / DNS failure on direct attach** — the URL is
  in-cluster only; you must go through the gateway.
- **401 at the gateway** — your `ADMIN_MCP_TOKEN` is wrong, not Stripe's
  key (Stripe's is baked downstream).
- **Numbers don't match the Stripe dashboard** — timezone and
  gross-vs-net differences; state the period bounds and whether fees are
  included in what you report.
- **Empty subscription list but MRR exists** — recurring mobile revenue
  lives in RevenueCat, not Stripe.

## Cautions

Read-only, so no approval gates — but revenue figures drive decisions:
quote the exact period and currency, and never paste Stripe keys into
chat (you never need them).
