---
name: quizverse-rewards-safety
description: Review QuizVerse rewards and entries before claiming.
version: 1.0.0
author: Devashish Badlani (@devashishbadlani), Hermes Agent
platforms: [macos, linux, windows]
metadata:
  hermes:
    tags: [quizverse, wallet, rewards, safety, mcp]
    category: gaming
    related_skills: [quizverse-social-party]
---

# QuizVerse Rewards Safety Skill

Review balances, entitlements, tournament entries, and earned claims with
explicit player consent. This skill cannot adjust wallets or grant rewards.

## When to Use

- The player asks about balances or product access.
- The player wants to enter a tournament.
- The player wants to claim an earned QuizVerse reward.

## Prerequisites

- Wallet and entitlement reads require an authenticated player session.
- Use only curated QuizVerse player MCP tools.
- Never ask the player to paste a token, purchase secret, or receipt.

## How to Run

1. Read `qv_wallet_get`, `qv_entitlements_get`, or `qv_tournaments_list`.
2. State any visible cost, target, and expected effect.
3. Ask for approval before entry or claim.

## Quick Reference

- Wallet: `qv_wallet_get`
- Entitlements: `qv_entitlements_get`
- Tournaments: `qv_tournaments_list`
- Enter: `qv_tournament_enter`
- Claim: `qv_reward_claim`

## Procedure

1. Read current state before proposing a write.
2. Confirm the exact tournament or reward identifier.
3. Explain that service validation determines eligibility.
4. Obtain explicit approval.
5. Use one stable idempotency key and report the service result.

## Pitfalls

- A displayed balance is not authorization to spend.
- Do not promise claim eligibility or tournament acceptance.
- Never retry a value-bearing action with a new idempotency key.

## Verification

- Before-and-after state is clear when reads are available.
- No wallet adjustment or admin endpoint was used.
- The audit-safe result includes no credentials.
