---
name: ivx-stack-tour
description: A complete tour of the intelli-verse-x 5-layer stack — Leantime/GitHub at the top, Beads/Bernstein/Claude-Squad in the middle, Gas Town as the multi-project fabric, and LiteLLM/Infisical/Langfuse/n8n/GH-Actions underneath. Use whenever the user asks "what does X service do", "where does Y data live", "how do I get to Z", or you need to understand which tool to reach for. This is the architecture map.
version: 1.0.0
metadata:
  hermes:
    tags: [architecture, infrastructure, intelli-verse-x, stack, runbook]
    related_skills: [ivx-content-factory-pipeline, ivx-gastown-sling]
---

# intelli-verse-x — 5-layer stack tour

## When to use this skill

- User mentions a service by name and you're not 100% sure what it does.
- You're picking which tool to reach for and want the canonical map.
- User asks "is X live?" / "what's the endpoint for Y?".
- Anything that smells like an architecture question.

## The stack at a glance

```
┌─ Layer 1: STRATEGY (humans live here) ─────────────────────────────────┐
│  Leantime ─── strategic project mgmt (tickets, milestones, time)        │
│  GitHub Issues + Projects ─── code work (PR auto-close on "Fixes #N")   │
└─────────────────────────────────────────────────────────────────────────┘
┌─ Layer 2: COORDINATION (humans + agents meet) ─────────────────────────┐
│  Beads (bd) ─── the agentic data backbone (graph of issues, deps)       │
│  Bernstein ─── per-project autonomous crew (44 adapters, audit, lineage)│
│  Claude Squad ─── interactive solo coding TUI (host-side)               │
└─────────────────────────────────────────────────────────────────────────┘
┌─ Layer 3: MULTI-PROJECT FABRIC ────────────────────────────────────────┐
│  Gas Town ─── rigs, crew identities, mayor, witness, refinery, deacon   │
│             ─── exposes itself as an MCP server (gt mcp serve)          │
└─────────────────────────────────────────────────────────────────────────┘
┌─ Layer 4: PLATFORM ────────────────────────────────────────────────────┐
│  LiteLLM ─── model gateway (virtual keys, budgets, Langfuse callback)   │
│  Infisical ─── MIT secrets manager (Postgres + Redis + machine ident.)  │
│  Langfuse ─── open-source LLM observability (traces land here)          │
└─────────────────────────────────────────────────────────────────────────┘
┌─ Layer 5: GLUE ────────────────────────────────────────────────────────┐
│  n8n ─── workflow automation (gt-escalate→Discord, timesheets→Stripe)   │
│  GitHub Actions ─── per-repo lint/test/build + cross-provider PR review │
└─────────────────────────────────────────────────────────────────────────┘
```

Hermes (you) sit *on top* of this stack as the conversational interface.

## Endpoints

| Service | URL | Auth | Owns |
|---|---|---|---|
| Leantime | https://leantime.intelli-verse-x.ai | Session / Bearer | Tickets, projects, milestones, timesheets |
| Leantime MCP | https://leantime-mcp.intelli-verse-x.ai/mcp | Cluster-side | Bridges Leantime JSON-RPC → MCP |
| LiteLLM | https://litellm.intelli-verse-x.ai | `LITELLM_API_KEY` | Model gateway |
| Infisical | https://infisical.intelli-verse-x.ai | Machine identity | Secrets |
| Langfuse | https://langfuse.intelli-verse-x.ai | Project keys | LLM traces |
| n8n | https://n8n.intelli-verse-x.ai | `X-N8N-API-KEY` | Workflows |
| Content Factory | (in-cluster) | API key | 50+ media pipelines |

## Pull cluster secrets

You don't have to ask the user for these — pull them from k8s:

```bash
# LiteLLM master key
kubectl get secret litellm-master-key -n aicart -o jsonpath='{.data.key}' | base64 -d

# n8n API key (minted with the live JWT secret, never expires)
kubectl get secret n8n-admin -n aicart -o jsonpath='{.data.API_KEY}' | base64 -d

# Infisical machine identity (Bearer token for the agent vault)
kubectl get secret infisical-admin -n aicart -o jsonpath='{.data.MACHINE_IDENTITY_TOKEN}' | base64 -d

# Leantime MCP bot bearer (only if you're talking directly to leantime; the
# MCP bridge already has it baked in)
kubectl get secret leantime-mcp-bot -n aicart -o jsonpath='{.data.BEARER_TOKEN}' | base64 -d
```

## The two architectural rules

1. **Beads is the single source of truth.** Never carry state in
   `gt nudge` / `gt mail` prose. Update the bead. Other agents read it.
2. **Tool-bloat kills completion.** Don't enable every MCP at once.
   Vercel's 2026 research and Atlan show degradation above ~20 tools.
   Per-role MCP allowlists in `gastown/internal/hooks/mcp.go` enforce this.

## Source-of-truth pointers

- Architecture canvas: `intelli-verse-kube-infra/docs/canvases/final-stack.canvas.tsx`
- Full runbook: `intelli-verse-kube-infra/docs/wiki/Agentic-stack.md`
- A-Z catalogue: `intelli-verse-kube-infra/docs/wiki/A-Z-list.md`
- Bead structure: `BEADS_DIR=/gt/.beads bd show hq-2mq`
