---
name: ivx-mcp-game-ops
description: The "Game ops" MCP tiles — Nakama game backend (players, wallets, flags, configs) and the QuestX rewards economy (~120 tools for brands, quests, offers, redemptions, gift cards, fraud). Use for player lookups, bans, wallet inspection, and rewards-economy operations.
version: 1.0.0
metadata:
  hermes:
    tags: [mcp, games, nakama, questx, players, rewards, wallets]
    related_skills: [ivx-mcp-directory, ivx-mcp-commerce]
---

# Game ops — player & rewards-economy MCPs

## When to use this skill

- Player lookups: account, wallet, ban/unban, leaderboard state (Nakama).
- Feature flags and live configs on the game backend.
- Rewards economy: brands, quests, offers, redemptions, gift cards,
  staking, coupons, fraud checks (QuestX).

## The tiles in this group

Registry group `game-ops`. Gateway tileId is what `admin_call_mcp` takes.

| Tile id | Gateway tileId | What it does | Auth |
|---|---|---|---|
| `nakama-console` | `nakama` | Game-ops MCP: player inspect, wallets, flags, configs, generic RPC | Server-side admin auth (`http_key`) baked; no token needed. Endpoint `https://nakama-mcp.intelli-verse-x.ai/`. |
| `quests` | `questx` | QuestX rewards economy, ~120 tools: brands, quests, offers, redemptions, gift cards, staking, coupons, fraud checks | No token needed. In-cluster only (`quests-api.quests-economy.svc.cluster.local:3002/mcp`, session handshake) — gateway required. |

Apps covered: `intelliverse`, `quizverse`, `questx` (per the tile appIds).

Portal-only tiles (no MCP — launch the UI): `nakama-analytics`
(retention/DAU/MAU dashboard), `quizverse` (quiz builder), `quizx` /
`quizx-admin` (storefront), `game-dev-portal` (developer onboarding).

## How to reach them

**Nakama direct attach:** `https://nakama-mcp.intelli-verse-x.ai/` — no
token needed (admin auth is server-side).

**QuestX is in-cluster only — the gateway is the only path from outside:**

```
admin_call_mcp { tileId: "questx", method: "tools/list" }
admin_call_mcp { tileId: "nakama", method: "tools/call",
                 tool: "<name from tools/list>", arguments: { ... } }
```

Neither registry entry enumerates every tool (QuestX has ~120) — start
with `tools/list` and filter by keyword (brand, quest, redemption, fraud,
gift, coupon, wallet, player) rather than reading the whole list.

## Task recipes

**Player investigation.** Nakama: look up the player by username/id →
inspect account + wallet → check recent leaderboard entries. If the user
then asks for a ban, that's a write — confirm the exact account id first.

**Redemption review.** QuestX: list pending redemptions → pull the
conversion + fraud-check detail for the flagged ones → summarize evidence
per case; the approve/reject click stays with the operator
(`/admin/gift-card-review` in the portal).

**"Which quests are live?"** QuestX quest-listing tools → cross-reference
offers and brands → table of live quests with reward config.

**Feature-flag check before a live-ops change.** Nakama: read current
flags/configs → show the diff the user wants → apply only after approval
(flags change live game behavior for all players).

## Cautions

- Bans, wallet adjustments, flag/config changes, and quest/offer mutations
  all hit **live players and real money value** — always show what will
  change and get approval.
- Nakama's generic RPC tool can call any of the 1000+ server RPCs — prefer
  the purpose-built tools; use generic RPC only when you know the exact
  RPC id and payload.
- Never paste keys into chat; Nakama and QuestX auth is baked server-side.
