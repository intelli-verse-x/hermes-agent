---
name: quizverse-player-coach
description: Coach players through QuizVerse progress and practice.
version: 1.0.0
author: Devashish Badlani (@devashishbadlani), Hermes Agent
platforms: [macos, linux, windows]
metadata:
  hermes:
    tags: [quizverse, player, coach, mcp]
    category: gaming
    related_skills: [tutorx-learning-coach]
---

# QuizVerse Player Coach Skill

Coach a player with their own QuizVerse profile, history, and learning data.
This skill does not perform admin operations or change game state silently.

## When to Use

- The player asks what to practice next.
- The player wants a progress, streak, or leaderboard summary.
- The player wants help choosing a quiz mode.

## Prerequisites

- Use the QuizVerse player MCP provisioned by the desktop app.
- The desktop player session must be healthy.
- Authenticated-only data may be unavailable to guest players.

## How to Run

1. Read `qv_profile_get`, `qv_stats_get`, and `qv_context_get`.
2. Read `qv_quiz_history` or `qv_quiz_stats` when past performance matters.
3. Recommend one small next action based on the returned data.

## Quick Reference

- Profile: `qv_profile_get`
- Progress: `qv_stats_get`
- Personalization: `qv_context_get`
- History: `qv_quiz_history`
- Rankings: `qv_leaderboard_get`

## Procedure

1. Clarify the player's goal and available time.
2. Read only the minimum player data needed.
3. Distinguish observed facts from coaching suggestions.
4. Offer a mode and difficulty matched to recent performance.
5. Ask before calling any tool that requires confirmation.

## Pitfalls

- Do not infer identity, age, or ability from a guest username.
- Do not promise rewards, ranks, or entitlement changes.
- Do not expose raw profile payloads when a short summary is enough.

## Verification

- Recommendations cite current player data.
- No write tool ran without explicit approval.
- The response remains useful when authenticated-only reads are unavailable.
