---
name: ivx-gbrain
description: Load IX Agency App-ID gBrain rules — company brain pointer, App-ID ai.intelli-verse-x.ix-agency, portal scope, ContentX/desktop isolation from QuizVerse.
version: 1.0.0
author: intelli-verse-x
platforms: [macos, linux, windows]
metadata:
  hermes:
    tags: [gbrain, app-id, ix-agency, desktop]
    category: platform
---

# IX Agency gBrain Skill

Use when the user asks about company structure, App-ID scope, which desktop/product owns work, portal grants, or whether something is Agency vs QuizVerse.

## Canonical IDs

- **App-ID:** `ai.intelli-verse-x.ix-agency`
- **Slug:** `ix-agency`
- **S3:** `s3://intelliverse-x-desktop/ix-agency/*`
- **Child brain (monorepo):** `_brain/apps/ix-agency/`
- **Parent brain:** `_brain/` (company gBrain)

## Rules to enforce

1. Stay on Agency App-ID for tools, ContentX, ads, and admin MCP.
2. Do not ship or recommend QuizVerse player MCP / consumer surfaces from this app.
3. File nontrivial work as beads; sling specialists via Gas Town when needed.
4. Respect human approval gates (cross-repo, spend, client output).

## Read next

- `$HERMES_HOME/AGENTS.md` (seeded by desktop brand provision)
- Monorepo `_brain/index/APP_ID_REGISTRY.md` when available on disk
