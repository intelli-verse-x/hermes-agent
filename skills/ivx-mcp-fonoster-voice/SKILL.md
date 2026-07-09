---
name: ivx-mcp-fonoster-voice
description: Place AI voice calls and manage voice applications, numbers, and trunks on the self-hosted Fonoster deployment via its MCP. Use when the user asks to call someone, list voice apps, or check call status.
version: 1.0.0
metadata:
  hermes:
    tags: [mcp, fonoster, voice, call, voip, ivr, telephony]
    related_skills: [ivx-mcp-talk-to-people, ivx-mcp-directory]
---

# Fonoster — AI voice calls

## What it is

Fonoster (`https://fonoster.intelli-verse-x.ai`) is the self-hosted VoIP
stack: outbound calls (including AI-agent-driven calls via Autopilot),
inbound IVRs, numbers, trunks, and recordings.

- Tile id: `fonoster` (group "Talk to people")
- MCP endpoint: `https://fonoster-mcp.intelli-verse-x.ai/`
- Auth: `Authorization: Bearer <accessKeyId:apiKey:apiSecret>` — the three
  values colon-joined, from Workspace → API Keys. Gateway default is
  wired — `admin_call_mcp { tileId: "fonoster" }` needs no token.

There is also a deeper local skill pair (`fonoster-voice`,
`fonoster-ops`) for SDK-level call placement and cluster ops — prefer
those if they're installed and the task is complex.

## Key tools

The registry doesn't enumerate tools — discover them:

```
admin_call_mcp { tileId: "fonoster", method: "tools/list" }
```

Expect application/number/trunk listing and call-creation tools ("List our
Fonoster voice applications" is the canonical smoke test).

## Worked example — "call +1555… with the sales agent and tell me how it went"

1. `tools/list` → find the application-list and call-create tools.
2. List applications → pick the requested voice agent, note its ref.
3. **Stop and confirm**: destination number, caller id, and which app will
   speak — an outbound call to a real phone is a write action.
4. Create the call `{ from: <our number>, to: <destination>, appRef: ... }`.
5. Poll/fetch the call status tool until terminal (answered / no-answer /
   busy / failed); report duration and, if available, the recording ref.

## Common failure modes

- **401 Unauthorized** — malformed Bearer: it must be all three parts
  `accessKeyId:apiKey:apiSecret`, not the apiKey alone. Or use the gateway.
- **Call created but never rings** — trunk/number misconfig or SIP routing;
  that's ops territory (`fonoster-ops` skill / the aicart cluster), not a
  retry-until-it-works situation. Don't re-dial more than once.
- **App not found** — voice applications are workspace-scoped; list apps
  first and use the exact ref instead of guessing names.
- **Long silences on the call** — Autopilot LLM latency; check the app's
  configured model before blaming the trunk.

## Cautions

Outbound calls ring real phones and cost money — always confirm the number
and agent before dialing, never call lists of people without explicit
approval, and never paste the API key triplet into chat.
