---
name: quizverse-social-party
description: Manage QuizVerse friends and async challenges safely.
version: 1.0.0
author: Devashish Badlani (@devashishbadlani), Hermes Agent
platforms: [macos, linux, windows]
metadata:
  hermes:
    tags: [quizverse, friends, challenges, mcp]
    category: gaming
    related_skills: [quizverse-rewards-safety]
---

# QuizVerse Social Party Skill

Help authenticated players inspect friends and coordinate async challenges.
This skill never exposes social data for another player or bypasses consent.

## When to Use

- The player asks about friends or pending requests.
- The player wants to invite or challenge an exact account.
- The player wants to create, join, or submit an async challenge.
- The player wants to create or join a matchmaking party.

## Prerequisites

- The player must use an authenticated QuizVerse account for social actions.
- Use only the QuizVerse player MCP.
- Obtain an exact target or challenge identifier.

## How to Run

1. Read `qv_friends_list` or `qv_async_status`.
2. Explain the proposed action and target.
3. Call a write tool only after explicit confirmation.

## Quick Reference

- Friends: `qv_friends_list`
- Invite: `qv_friend_invite`
- Challenge: `qv_friend_challenge`
- Async create: `qv_async_create`
- Async join: `qv_async_join`
- Async submit: `qv_async_submit`
- Party create: `qv_party_create`
- Party join: `qv_party_join`
- Party status: `qv_party_status`

## Procedure

1. Verify the account supports authenticated social actions.
2. Resolve ambiguity before selecting a target.
3. Show the target id, mode, and action.
4. Create one stable UUID idempotency key.
5. Make the first write call and let the native desktop approval appear.
6. After approval, repeat the exact call with its server-issued challenge.
7. Report the returned challenge or party state.

## Pitfalls

- Do not guess target ids from display names.
- Do not treat a pending invite as a friendship.
- Do not create replacement challenges after an uncertain timeout.

## Verification

- The intended target and mode are explicit.
- The approved action ran at most once.
- Guest capability failures are explained without requesting credentials.
