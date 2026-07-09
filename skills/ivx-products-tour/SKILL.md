---
name: ivx-products-tour
description: Inventory of the intelli-verse-x product portfolio — what each product is, its repo, primary tech, deployment status, and which other product/service it's coupled to. Use whenever the user mentions a product by name (Quizverse, IntelliverseX, Hyperframes, Brackt, IntelliverseSpace, Intelliverse-X-AI, Intelli-verse-X-SDK, content-factory, etc.) and you need the canonical pointer for what it does + where it lives.
version: 1.0.0
metadata:
  hermes:
    tags: [products, portfolio, intelli-verse-x, repos]
    related_skills: [ivx-stack-tour, ivx-content-factory-pipeline]
---

# intelli-verse-x product portfolio

## When to use this skill

- User says "the Quizverse thing" / "our games platform" / "the SDK" / "the
  content factory" and you need to know which repo + which deployment.
- You're filing a bead and need the right `--rig` flag.
- You're picking which product's skill to load next.

## The product map

### Games & Quiz

| Product | Repo (`intelli-verse-x/`) | What it is | Live URL |
|---|---|---|---|
| **Quizverse** | `Quizverse-web-frontend` | Web frontend for the quiz platform. | https://quizverse.app |
| **Quizverse mobile** | (in Quizverse-web-frontend) | React Native build sharing the same backend. | |
| **Intelli-verse-X games** | `intelliverse-x-games-platform-2` | The games meta-platform (Wyvern, etc.). | https://intelli-verse-x.com |
| **Intelli-verse-X SDK** | `Intelli-verse-X-SDK` | The TS SDK consumed by every game (auth, monetization, live-ops, leaderboards). | npm: `@intelli-verse-x/sdk` |
| **Hyperframes** | `hyperframes` | 3D/AR/AVR framework. Skills under `hyperframes/skills/`. | |

### Tooling & infra

| Product | Repo (`intelli-verse-x/`) | What it is | Live URL |
|---|---|---|---|
| **Gas Town** | `gastown` | The multi-rig agent fabric. Also exposes `gt` as an MCP server. | (CLI / in-cluster) |
| **Beads** | `beads` | The agentic data backbone (issue graph). `bd close` is fail-closed. | (CLI; Dolt remote: `intelli-verse-x/gastown-beads`) |
| **Leantime MCP** | `leantime-mcp` | OSS MCP bridge to Leantime. | https://leantime-mcp.intelli-verse-x.ai |
| **Leantime marketplace mirror** | `leantime-marketplace-mirror` | Curated plugin mirror + paid-plugin procurement notes. | (repo only) |
| **Kube infra** | `intelli-verse-kube-infra` | Every k8s manifest for the cluster. | (repo only) |
| **Hermes deployment** | `hermes-deployment` | This repo: pre-wired Hermes Agent for the stack. | (repo only) |
| **Content Factory** | `content-factory` (forked) | Agentic video/image/audio generation (50+ pipelines). | https://content-factory.intelli-verse-x.ai |

### Skills repos

| Repo | What's in it |
|---|---|
| `intelli-verse-x-agent-skills` | Purpose-built skills for our stack: aso-brief, content-factory-pipeline, game-trailer, gastown-sling, k8s-gpu-rollout. |
| `Intelli-verse-X-SDK/skills/` | SDK-specific skills: game-sdk, ai-integration, cross-platform, live-ops, monetization, multiplayer, quiz-content, sdk-setup, store-launcher, platforms. |
| `Agentic-SEO-Skill` | SEO playbooks. |
| `geo-optimizer-skill` | GEO playbooks. |
| `agent-skills` | The broader Anideebee skills collection (KB-injection, KB-rag, web-design, mobile-design). |

All of these are pre-wired into your `skills.external_dirs` in
`~/.hermes/config.yaml`.

## Filing beads against the right rig

Beads route by prefix. If the issue is about:

- a code change to `gastown` → `bd create --rig gastown "..."`
- a code change to `beads` → `bd create --rig beads "..."`
- a content-factory pipeline → `bd create --rig content-factory "..."`
- a game feature in the games platform → `bd create --rig intelliverse-x-games "..."`
- cross-cutting (Hermes itself, hq coordination) → `bd create "..."` (HQ)

If you're unsure: `bd rig list` shows every registered rig and prefix.

## The "which product is this in?" decision tree

1. Mobile/web quiz UI → Quizverse.
2. Generic game UI / leaderboards / monetization → games-platform or SDK.
3. 3D/AR/AVR → Hyperframes.
4. Issue tracking / agent coordination → Gas Town + Beads.
5. Video/image/audio generation → Content Factory.
6. Strategic tickets / time tracking → Leantime.
7. Anything else → check `~/dev/` listing or ask the user.
