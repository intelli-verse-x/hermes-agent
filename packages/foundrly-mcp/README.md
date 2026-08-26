# Foundrly product-knowledge MCP

First-party MCP for **Foundrly desktop left-rail Hermes** only.

## Scope

| In scope | Out of scope |
|---|---|
| `fd_product_knowledge` — bundled Foundrly product facts | Mail Studio, CRM, Automation Studio |
| Stdio MCP (no secrets / no cloud broker) | Live Foundrly SaaS admin APIs |
| Foundrly brand boot provision | IX Agency / QuizVerse |

Portal admin tools stay on **Foundrly → Admin copilot** (web portal chat).

## Transport

Hermes spawns this `server.mjs` over **stdio** (Electron `ELECTRON_RUN_AS_NODE=1`
in packaged builds). No local broker socket and no credentials in `config.yaml`.

## Tool

- `fd_product_knowledge` — returns the bundled `knowledge.md` text.
