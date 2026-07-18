---
name: ivx-gbrain
description: Load QuizVerse App-ID gBrain rules — company brain pointer, App-ID ai.intelli-verse-x.quizverse, player MCP scope, ContentX/desktop isolation from IX Agency.
version: 1.0.0
author: intelli-verse-x
platforms: [macos, linux, windows]
metadata:
  hermes:
    tags: [gbrain, app-id, quizverse, desktop]
    category: platform
---

# QuizVerse gBrain Skill

Use when the user asks about App-ID scope, QuizVerse vs Agency, ContentX brand kit, player MCP, or product brain rules.

## Canonical IDs

- **App-ID:** `ai.intelli-verse-x.quizverse`
- **Slug:** `quizverse`
- **S3:** `s3://intelliverse-x-desktop/quizverse/*`
- **Child brain (monorepo):** `_brain/apps/quizverse/`
- **Parent brain:** `_brain/` (company gBrain)

## Rules to enforce

1. Stay on QuizVerse App-ID for player MCP, ContentX, quests, and analytics.
2. Do not pull IX Agency admin connectors or super-admin surfaces into player flows.
3. Least-privilege: no cross-user data, no silent wallet/admin mutations.
4. Point Agency/ads HQ asks to the IX Agency desktop.

## Read next

- `$HERMES_HOME/AGENTS.md` (seeded by desktop brand provision)
- Monorepo `_brain/index/APP_ID_REGISTRY.md` when available on disk
