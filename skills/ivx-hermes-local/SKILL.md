---
name: ivx-hermes-local
description: Install, configure, and run Hermes Agent locally on a laptop/workstation with the full intelli-verse-x wiring — LiteLLM gateway, admin-mcp, self-hosted Firecrawl, org skills, and the IX Agency desktop app. Use when someone asks "how do I get Hermes on my machine", when bootstrapping a new employee system, or when a local install is missing MCPs/tools/skills that the org supports.
version: 1.0.0
metadata:
  hermes:
    tags: [hermes, install, local, setup, onboarding, mcp, firecrawl, litellm]
    related_skills: [ivx-hermes-cloud-delegate, ivx-mcp-directory, ivx-stack-tour]
---

# Local Hermes on your system — the intelli-verse-x way

## When to use this skill

- Fresh machine that needs Hermes with all org services wired.
- An existing local install is missing MCP servers, skills, or the
  self-hosted Firecrawl and you need to bring it up to org parity.
- Someone asks what a "correct" local `~/.hermes` looks like here.

## One-shot install (recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/intelli-verse-x/hermes-deployment/main/scripts/install-local.sh | bash
```

That script (repo: `intelli-verse-x/hermes-deployment`):

1. Installs hermes-agent via the official NousResearch one-liner if missing.
2. Seeds `~/.hermes/config.yaml` + `AGENTS.md` from `config/` (diffs, never
   clobbers an existing file).
3. Symlinks the org skill bundle to `~/.hermes/skills/ivx-deployment`
   (so `git pull` in hermes-deployment updates skills in place).
4. Checks prerequisites: `gt`, `bd`, `firecrawl`, `npx`, `uvx`, plus
   git/gh/kubectl for coding-loop and deploy work.
5. Tells you which env keys are still empty.

## Required env (`~/.hermes/.env`)

| Key | Value / where to get it |
|-----|------------------------|
| `OPENAI_API_KEY` | LiteLLM virtual key (litellm.intelli-verse-x.ai; ask infra or mint via `litellm/scripts/mint-role-keys.sh`) |
| `ADMIN_MCP_TOKEN` | Scoped to your email's access grant. Super admins: `kubectl get secret admin-mcp-token -n aicart -o jsonpath='{.data.ADMIN_MCP_TOKEN}' \| base64 -d`. Everyone else: ask a super admin |
| `FIRECRAWL_API_URL` | `https://firecrawl.intelli-verse-x.ai` (self-hosted on EKS) |
| `FIRECRAWL_API_KEY` | any non-empty value, e.g. `self-hosted` (instance is unauthenticated) |
| `GH_TOKEN` | your GitHub PAT if you want PR/issue workflows |

Per-service MCP tokens (`NOTIFUSE_MCP_TOKEN`, `TWENTY_MCP_TOKEN`, …) are
optional — leave empty to reach those services through the admin-mcp
gateway instead. See `config/.env.example` in hermes-deployment for the
full list and where each token comes from.

## What the seeded config gives you

- **Model routing** through the org LiteLLM proxy
  (`https://litellm.intelli-verse-x.ai/v1`) — one shared budget envelope.
- **MCP servers**: `admin-mcp` gateway (7 meta-tools fanning out to every
  admin portal tile), 13 direct EKS MCPs (notifuse, whatsapp, fonoster,
  postiz, twenty, chatwoot, telnyx, nakama-console, grafana, documenso,
  intelliverse-mcp, agent-mcp, open-seo), `firecrawl`, `gastown`, `n8n`,
  content-factory.
- **Skills**: org bundles from hermes-deployment, hermes-agent fork
  (`ivx-*` + `ivx-mcp-*` catalog), nakama `.agents/skills`, and curated
  upstream packs. Same SKILL.md folders work in Cursor, Claude Code,
  Codex, and Goose.

## Verify the install

```bash
hermes doctor          # config + connectivity checks
hermes mcp list        # every server above should show connected/ready
hermes chat -q "search the web for intelliverse quizverse and cite the tool used"
```

`hermes doctor` failures to check first: empty `OPENAI_API_KEY` (LiteLLM),
`ADMIN_MCP_TOKEN` missing (admin-mcp shows unauthorized), VPN required for
cluster-local-only endpoints.

## Desktop app (IX Agency)

The org's rebranded Hermes Desktop lives in `intelli-verse-x/hermes-agent`
branch `feat/ix-agency`; installers publish to the S3 feed
(`intelliverse-x-desktop/ix-agency/`) and auto-update in place. On portal
login (admin.intelli-verse-x.ai email OTP) the app auto-attaches the MCP
directory, dynamic connectors, and org skills — no manual wiring.

## Updating

```bash
hermes update                        # hermes itself
git -C ~/dev/hermes-deployment pull  # org config + skills (symlinked)
```

## Related

- Delegating work to the cloud workers instead of running locally:
  `ivx-hermes-cloud-delegate`.
- What each MCP/tool does and how to call it: `ivx-mcp-directory` and the
  `ivx-mcp-*` skills.
