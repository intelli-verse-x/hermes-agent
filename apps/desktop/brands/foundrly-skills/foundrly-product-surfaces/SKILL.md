---
name: foundrly-product-surfaces
description: Explain Foundrly desktop chat vs Admin copilot.
version: 1.0.0
author: Intelliverse X, Hermes Agent
platforms: [macos, linux, windows]
metadata:
  hermes:
    tags: [foundrly, product, admin-copilot, desktop]
    category: business
    related_skills: [foundrly-cofounder-coach, foundrly-overnight-visibility]
---

# Foundrly Product Surfaces Skill

Teach users which Foundrly surface to use. Left-rail Hermes chat and Admin
copilot are different. Do not merge them.

## When to Use

- The user asks where to chat, how to open admin tools, or why two chats exist.
- They expect portal tools (Mail Studio, CRM, Automation) in left-rail chat.
- They need links to Foundrly web or the admin portal.

## Prerequisites

- Foundrly desktop is open.
- Call `fd_product_knowledge` for the authoritative surfaces table.
- Admin copilot needs email OTP and a Foundrly-scoped portal grant.
- Left-rail Hermes needs a configured inference provider (API key / LiteLLM).

## How to Run

1. Call `fd_product_knowledge` with topic `surfaces` when explaining where to work.
2. Name the surface: left-rail Hermes vs Foundrly → Admin copilot vs Home links.
3. Match the job: local files/terminal → left-rail; scoped admin tools → Admin
   copilot; marketing site / overnight product UI → Foundrly web / Home.
4. Give the click path in one short list.

## Quick Reference

| Need | Surface |
|---|---|
| Local AI + tools on this PC | Left-rail Hermes (New session) |
| Foundrly product facts | MCP `fd_product_knowledge` |
| Foundrly-scoped portal tools (Mail Studio, CRM) | Foundrly → Admin copilot |
| Product website | Open Foundrly web (getfoundrly.com) |
| Full admin UI | Open Foundrly admin portal |

## Procedure

1. If they want Mail Studio / CRM / Automation Studio → Admin copilot + OTP.
2. If they want identity/cofounder help or local ops → left-rail chat.
3. If chat fails with no provider configured → Settings / Hermes `.env` key,
   not admin portal login alone.

## Pitfalls

- Admin portal login does not inject left-rail Hermes API keys.
- Left-rail chat does not receive web `app_id` scope automatically.
- Do not send users to IX Agency Connect/VPN for Foundrly work.

## Verification

- User can repeat which surface to open for admin tools vs local chat.
- No instruction points them at QuizVerse or IX Agency product tabs.
