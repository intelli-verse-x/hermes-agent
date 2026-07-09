---
name: ivx-mcp-plan-track-work
description: The "Plan & track work" MCP tiles — Leantime project plans and n8n workflow automation. Use for project/task queries, milestone updates, and inspecting or toggling n8n automations.
version: 1.0.0
metadata:
  hermes:
    tags: [mcp, projects, tasks, automation, n8n, leantime]
    related_skills: [ivx-mcp-directory]
---

# Plan & track work — project & automation MCPs

## When to use this skill

- Reading or updating project plans, tasks, milestones (Leantime).
- Listing, inspecting, activating/deactivating n8n workflows; checking
  why an automation run failed.

## The tiles in this group

Registry group `plan-track`. Two tiles have MCP endpoints:

| Tile id | Gateway tileId | What it does | Auth |
|---|---|---|---|
| `leantime` | `leantime` | Project plans, tasks, milestones | Bearer = Leantime API key; default wired at gateway. Endpoint `https://leantime-mcp.intelli-verse-x.ai/rpc`. |
| `n8n` | `n8n` | Wrapper MCP: list/inspect workflows, activate/deactivate, inspect executions | Scoped API key baked; override with Bearer. Endpoint `https://n8n-mcp.intelli-verse-x.ai/`. |

Portal-only tiles (no MCP — launch the UI): `marblism-transcripts`
(meeting transcripts + AI summaries), `kan` (kanban board), `vibe-kanban`
(engineering), `bracket` (tournaments), `app-release` (release scheduling),
`console-users-access` (legacy user/role admin).

## How to reach them

**Direct attach:** the endpoints above with `Authorization: Bearer <key>`.
Note Leantime's endpoint path is `/rpc`, not `/mcp`.

**Gateway (tokens pre-wired):**

```
admin_call_mcp { tileId: "n8n", method: "tools/list" }
admin_call_mcp { tileId: "leantime", method: "tools/call",
                 tool: "<name from tools/list>", arguments: { ... } }
```

Neither tile's registry entry enumerates its tools — always start with
`tools/list` and pick from what the server actually reports.

## Task recipes

**"What's the status of project X?"** Leantime `tools/list` → find the
project/task listing tools → pull open tasks and milestones → summarize
by status with owners and due dates.

**"Why didn't the automation run?"** n8n: list workflows → find the one by
name → inspect its recent executions → report the failing node and error
message. If a fix requires editing the workflow, that's portal work
(`https://n8n.intelli-verse-x.ai`) — link the operator there.

**Pause a misbehaving automation.** n8n deactivate tool on the workflow —
this is a write (stops production automation), so confirm first; reactivate
the same way after the fix.

**Meeting → tasks.** Meeting transcripts live in the portal tile
(`/admin/meeting-transcripts`, no MCP). Given a transcript's action items,
create the matching Leantime tasks (write — confirm the list first).

## Cautions

- Activating/deactivating n8n workflows and creating/closing Leantime tasks
  are write actions — get approval before each.
- Deactivating a workflow silently stops whatever it powers (blog pipeline,
  competitor intel, escalations) — state the blast radius when asking.
- Never paste API keys into chat; gateway defaults are wired.
