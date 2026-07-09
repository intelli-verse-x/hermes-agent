---
name: ivx-mcp-posthog
description: Product analytics through PostHog's official hosted MCP — insights, dashboards, HogQL queries, session replays, feature flags, error tracking. Use for funnel/retention questions, event deep-dives, and flag lookups.
version: 1.0.0
metadata:
  hermes:
    tags: [mcp, posthog, product-analytics, hogql, funnels, feature-flags, replays]
    related_skills: [ivx-mcp-measure-monitor, ivx-mcp-directory]
---

# PostHog — product analytics

## What it is

PostHog's **official hosted MCP** over the org's US-cloud PostHog
instance: insights, dashboards, HogQL, session replays, feature flags,
and error tracking.

- Tile id: `posthog` (group "Measure & monitor")
- MCP endpoint: `https://mcp.posthog.com/mcp` (externally reachable —
  direct attach works)
- Auth: `Authorization: Bearer <personal API key>` (`phx_...`, PostHog
  Settings → Personal API keys). A platform default is seeded at the
  gateway (`POSTHOG_MCP_TOKEN`, secret `posthog-mcp-secret`), so
  `admin_call_mcp { tileId: "posthog" }` needs no key.

## Key tools

Tool names are PostHog's own and evolve — discover them:

```
admin_call_mcp { tileId: "posthog", method: "tools/list" }
```

Expect insight/dashboard CRUD, a HogQL query runner, feature-flag
management, and error-tracking queries. The gateway treats
list/get/retrieve/search/query/read-style tools as read-only; anything
else (creating insights, toggling flags) counts as a write.

## Worked example — "what's the signup funnel conversion this week, and did the new flag change it?"

1. `tools/list` → find the query/insight tools.
2. Run the funnel: either an existing insight (search insights for
   "signup funnel") or a HogQL query over the signup events for this week
   vs last.
3. Look up the feature flag by key → note its rollout % and variants.
4. Segment the funnel by flag variant (HogQL `properties.$feature/<key>`).
5. Report: conversion per step, week-over-week delta, per-variant split.
   If asked to *change* the flag rollout — that's a write to production
   behavior: confirm first.

## Common failure modes

- **401 Unauthorized** — bad/expired `phx_` key, or the gateway default
  token isn't seeded yet (`posthog-mcp-secret`). Report it; don't ask the
  user to paste a key into chat.
- **403 / missing scope** — personal API keys are scoped; a key without
  `insight:read` or `feature_flag:write` fails only on those tools.
  The error names the missing scope — regenerate the key with it.
- **Wrong project** — org has multiple PostHog projects; if numbers look
  off by 10x, check which project id the tool call targeted.
- **HogQL errors** — property names are case-sensitive and event names
  exact; list events/properties first instead of guessing.

## Cautions

Feature flags gate live product behavior — never create/modify/delete a
flag without explicit approval. Session replays contain user PII: quote
aggregates, don't dump replay contents into chat. Never paste `phx_` keys
into chat.
