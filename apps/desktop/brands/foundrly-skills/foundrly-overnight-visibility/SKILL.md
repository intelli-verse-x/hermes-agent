---
name: foundrly-overnight-visibility
description: Guide Foundrly overnight visibility and morning review.
version: 1.0.0
author: Intelliverse X, Hermes Agent
platforms: [macos, linux, windows]
metadata:
  hermes:
    tags: [foundrly, overnight, visibility, growth]
    category: business
    related_skills: [foundrly-cofounder-coach, foundrly-product-surfaces]
---

# Foundrly Overnight Visibility Skill

Help operators plan overnight visibility and morning review workflows for a
local business. Desktop Home is still MVP for product UI — link out when needed.

## When to Use

- The user asks about overnight scans, drafts, or morning results.
- They want a checklist for approve/reject growth content overnight.
- They confuse Discord/Telegram delivery with Foundrly overnight product UI.

## Prerequisites

- Product overnight UI lives primarily on Foundrly web / admin, not fully
  embedded in desktop Home today.
- Call `fd_product_knowledge` (topic `overnight`) for product boundaries.
- Use Admin copilot for Foundrly-scoped portal tools after OTP — not left-rail MCP.
- Messaging (Discord/Telegram) is a separate Hermes gateway setup.

## How to Run

1. Optionally call `fd_product_knowledge` with topic `overnight`.
2. Explain overnight visibility as: scan → draft → approve → morning review.
3. Offer a short operator checklist (who approves, what ships, what waits).
4. Open or point to Foundrly web / Admin copilot for product actions.
5. Only use Messaging if they already configured a bot and want delivery there.

## Quick Reference

- Foundrly Home → Overnight visibility card → Open Foundrly web
- Admin tools / scoped ops → Foundrly → Admin copilot
- Messaging bots → Messaging rail (needs bot token; not overnight product)

## Procedure

1. Clarify goal (more walk-ins, reviews, social posts, email, etc.).
2. Draft an overnight plan with inputs, approval gate, and morning summary.
3. Send product execution to web/admin surfaces; keep local chat for planning.
4. If they ask for live scan results you cannot see, say so and route correctly.

## Pitfalls

- Do not invent overnight scan results or campaign stats.
- Do not treat Messaging "Gateway needs setup" as an overnight product bug.
- Desktop Home may only deep-link to web until richer overnight UI ships.

## Verification

- User gets a clear overnight checklist plus the correct open path.
- No fake SaaS metrics are claimed from left-rail chat alone.
