---
name: quizverse-game-ops
description: Diagnose QuizVerse player sessions and gameplay errors.
version: 1.0.0
author: Devashish Badlani (@devashishbadlani), Hermes Agent
platforms: [macos, linux, windows]
metadata:
  hermes:
    tags: [quizverse, diagnostics, nakama, mcp]
    category: gaming
    related_skills: [quizverse-player-coach]
---

# QuizVerse Game Ops Skill

Diagnose player-scoped QuizVerse failures with least-privilege reads. This is
not an admin console and cannot ban players, alter wallets, or change servers.

## When to Use

- Profile, quiz, tournament, or challenge calls fail.
- Guest and authenticated capabilities behave differently.
- A player needs a reproducible support summary.

## Prerequisites

- Use the QuizVerse player MCP configured by QuizVerse Desktop.
- Keep the desktop open because it brokers player authentication.
- Use `terminal` only for local health checks that reveal no secrets.

## How to Run

1. Confirm whether the player session is guest or authenticated.
2. Call the smallest read tool that reproduces the failure.
3. Record the tool, safe inputs, error class, and retry outcome.

## Quick Reference

- Session read: `qv_profile_get`
- Quiz read: `qv_quiz_fetch`
- Tournament read: `qv_tournaments_list`
- Challenge read: `qv_async_status`
- TutorX read: `qv_tutorx_sessions`

## Procedure

1. Reproduce with a read operation before testing a write.
2. Separate offline, timeout, authentication, validation, and rate-limit errors.
3. Retry only transient failures once.
4. Never request arbitrary RPC names or credentials from the player.
5. Summarize the failing boundary and a safe next step.

## Pitfalls

- Guest limitations are capability checks, not server outages.
- A confirmation response is not a failed write.
- Do not route player issues through admin or operations MCP servers.

## Verification

- The reproduction uses a curated player tool.
- No token, key, or full private payload appears in output.
- Cleanup is unnecessary or explicitly documented.
