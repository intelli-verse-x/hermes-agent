---
name: ivx-mcp-agents
description: The "Agents" MCP tiles — the admin-mcp gateway itself, the Gas Town coding crew, the Intelliverse platform gateway (~1300 tools), and the Content Factory agent MCP. Use for meta-work — discovering tools, dispatching coding agents, or driving platform APIs.
version: 1.0.0
metadata:
  hermes:
    tags: [mcp, agents, gateway, gastown, intelliverse, meta]
    related_skills: [ivx-mcp-directory, ivx-gastown-bridge, ivx-content-factory]
---

# Agents — gateways & agent-infrastructure MCPs

## When to use this skill

- You need to discover/reach any other org MCP (admin-mcp gateway).
- Dispatching coding work to autonomous agents (Gas Town).
- Calling platform APIs — users, payments, games, kube — via the
  Intelliverse gateway.
- Running Content Factory pipelines programmatically.

## The tiles in this group

Registry group `agents`. Gateway tileId is what `admin_call_mcp` takes.

| Tile id | Gateway tileId | What it does | Auth |
|---|---|---|---|
| `admin-mcp` | — (this IS the gateway) | MCP over the tile registry: list tools, preflight, launch URLs, fan-out to every per-service MCP | Bearer = `ADMIN_MCP_TOKEN` (secret `admin-mcp-token`, ns `aicart`). Endpoint `https://admin-mcp.intelli-verse-x.ai/`. |
| `gastown` | `gastown` | Coding crew: assign coding tasks on our repos, track work batches | No token; in-cluster only — gateway required. Tools: `gastown_list_repos`, `gastown_assign_coding_task`, `gastown_work_batches`, `gastown_completed_work`. |
| `intelliverse-mcp` | `intelliverse` | Platform gateway (~1300 tools): admin/ai/product/game/user/payment/aws/kube APIs | Bearer = Intelliverse MCP API key; default wired. Endpoint `https://mcp.intelli-verse-x.ai/api/mcp`. Engineering facets also exist as `ivx-infra`, `ivx-gamedata`, `ivx-growth` gateway tileIds. |
| `agent-mcp` | `content-factory` | Content Factory agent MCP: pipeline runs, releases, ads, analytics (streamable-http, session handshake) | No token needed. Endpoint `https://agent-mcp.intelli-verse-x.ai/mcp`. |

Portal-only tiles (no MCP): `admin-chat` (the copilot UI itself),
`all-tools-grid` (tile launcher), `skills-md` (team playbook editor),
`automation-legacy`.

## The gateway meta-tools (admin-mcp)

These are the tools the gateway itself exposes:

| Tool | What it does |
|---|---|
| `admin_list_groups` | Tile groups (categories) with counts |
| `admin_list_tools` | Search/filter the ~70 tiles (`group`, `q`, `scope`, `mcpOnly`) |
| `admin_get_tool` | Full tile record + launch URL |
| `admin_preflight` | Probe tile URLs → ok/down |
| `admin_launch_url` | SSO launch link for a tile |
| `admin_mcp_directory` | Every downstream MCP server + auth hints + `hasDefaultToken` |
| `admin_call_mcp` | Fan-out: `tools/list` / `tools/call` on any downstream MCP |

`admin_call_mcp` signature: `{ tileId | mcpUrl, method: "tools/list" |
"tools/call", tool?, arguments?, token?, appId? }`. Token precedence:
explicit `token` arg > per-app connector token (`<id>__<appId>`) > platform
default. Session-handshake servers (Postiz, Grafana, Loki, QuestX,
Content Factory) are handled transparently. Pass `appId` to use an app's
own connected account instead of the platform default.

## Task recipes

**"What tools do we have for X?"** `admin_list_tools { q: "X" }` or
`admin_mcp_directory` → point at the tile and, if useful, the matching
`ivx-mcp-*` skill.

**Dispatch a coding task.** `gastown_list_repos` → confirm repo + a crisp
task description with the user (this **spawns a real agent that opens
PRs**) → `gastown_assign_coding_task` → track with `gastown_work_batches`
/ `gastown_completed_work`. Details in `ivx-gastown-bridge`.

**Platform API call (e.g. restart a deployment).** Intelliverse gateway
`k8s_*` tools via `admin_call_mcp { tileId: "intelliverse" }` (or the
`ivx-infra` facet). Restarts/deploys are writes — confirm first. With
~1300 tools, filter the `tools/list` output by keyword rather than reading
it all.

**Health sweep.** `admin_preflight { ids: [...] }` over the tiles the user
cares about → report ok/down with launch URLs for the broken ones.

## Cautions

- `gastown_assign_coding_task` spawns real coding agents that consume
  compute and open PRs — never dispatch without explicit confirmation.
- Intelliverse gateway writes (kube restarts, payments, user mutations)
  need approval; prefer the narrowest facet (`ivx-infra`, `ivx-gamedata`,
  `ivx-growth`) over the full gateway when scoping calls.
- Never paste `ADMIN_MCP_TOKEN` or any key into chat.
