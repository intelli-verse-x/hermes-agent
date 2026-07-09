---
name: ivx-mcp-talk-to-people
description: The "Talk to people" MCP tiles — email campaigns (Notifuse), WhatsApp (OpenBSP), voice calls (Fonoster), social scheduling (Postiz), CRM (Twenty), shared inbox (Chatwoot), newsletters (beehiiv), SMS (Telnyx). Use whenever the user wants to reach customers or leads on any outbound channel.
version: 1.0.0
metadata:
  hermes:
    tags: [mcp, outreach, email, whatsapp, voice, social, sms, crm]
    related_skills: [ivx-mcp-directory, ivx-mcp-notifuse-email, ivx-mcp-fonoster-voice, ivx-mcp-postiz-social, ivx-mcp-chatwoot-support]
---

# Talk to people — outbound & conversation MCPs

## When to use this skill

- Sending anything to a human: campaign email, WhatsApp message, SMS,
  phone call, social post, newsletter.
- Reading or replying to inbound conversations (Chatwoot shared inbox).
- Looking up or updating contacts, companies, and deals (Twenty CRM).

## The tiles in this group

Registry group `reach-out` ("Talk to people"). The **gateway tileId** column
is what you pass to `admin_call_mcp` — note where it differs from the tile id.

| Tile id | Gateway tileId | What it does | Auth |
|---|---|---|---|
| `notifuse` | `notifuse` | Marketing email + push campaigns, open tracking (workspace `intelliversex`) | Bearer = Notifuse API key; default wired at gateway |
| `whatsapp` | `openbsp` | Send/reply on WhatsApp Business via Evolution/OpenBSP | Bearer = OpenBSP API key; default wired at gateway |
| `fonoster` | `fonoster` | VoIP: outbound calls, inbound IVRs, recordings | Bearer = `accessKeyId:apiKey:apiSecret` (Workspace → API Keys); default wired |
| `postiz` | `postiz` | Schedule posts on Instagram, X, LinkedIn, TikTok from one calendar | Wrapper MCP, org key baked in — no token needed |
| `twenty` | `twenty` | CRM: people, companies, sales pipeline | Bearer = Twenty API key (Settings → Developers → API Keys); default wired |
| `chatwoot` | `chatwoot` | Shared inbox for email/chat/social customer conversations | Bearer = Chatwoot access token (Profile → Access Token); tools need `accountId` |
| `beehiiv` | `beehiiv` | Newsletters: subscribers, segments, sends | Official MCP is OAuth at `mcp.beehiiv.com`; gateway uses the self-hosted wrapper (Bearer = API key, needs `publicationId`) |
| `telnyx` | `telnyx` | Programmable SMS, numbers, balance, message history | Wrapper MCP, default key wired; override with Bearer |

MCP endpoints (for direct attach): `https://notifuse-mcp.intelli-verse-x.ai/mcp`,
`https://openbsp-mcp.intelli-verse-x.ai/`, `https://fonoster-mcp.intelli-verse-x.ai/`,
`https://postiz-mcp.intelli-verse-x.ai/`, `https://crm.intelli-verse-x.ai/mcp`,
`https://chatwoot-mcp.intelli-verse-x.ai/`, `https://mcp.beehiiv.com/mcp`,
`https://telnyx-mcp.intelli-verse-x.ai/`.

Portal-only tiles in this group (no MCP — launch the UI instead):
`postiz-studio` (built-in composer), `gojiberry` (lead outreach),
`support-tickets` (in-console ticket queue).

## How to reach them

Two paths; prefer whichever MCP client wiring you already have.

**1. Direct MCP attach.** Point your MCP client at the tile's `mcpUrl` with
the auth from the table (`Authorization: Bearer <token>` unless noted).
Discover tools with a standard `tools/list`.

**2. Through the admin-mcp gateway** (`https://admin-mcp.intelli-verse-x.ai/`,
Bearer = `ADMIN_MCP_TOKEN`). Default downstream tokens are pre-wired, so this
path needs no per-service keys:

```
admin_call_mcp { tileId: "openbsp", method: "tools/list" }
admin_call_mcp { tileId: "openbsp", method: "tools/call",
                 tool: "<name from tools/list>", arguments: { ... } }
```

`admin_mcp_directory` lists every downstream server with `hasDefaultToken`.

## Task recipes

**Campaign email, then WhatsApp follow-up.**
1. `admin_call_mcp` tileId `notifuse` → `tools/list`, find the list/broadcast
   tools; confirm the target list and draft with the user.
2. Send the campaign (write — needs approval).
3. A day later (or per instructions), tileId `openbsp` → send a short
   WhatsApp nudge to the segment that didn't open.

**Announce everywhere.** Draft one message; adapt per channel (email long,
WhatsApp short, social hooky). Show all drafts, get one approval, then:
notifuse campaign → openbsp broadcast → `postiz_create_post` (use
`postiz_list_integrations` + `postiz_find_slot` first). Report ids and
scheduled times per channel.

**Lead → CRM → first touch.** Create/find the person and company in
`twenty`, log the deal, then send the intro email via `notifuse` (or a
one-off SMS via `telnyx`). Twenty's built-in MCP uses a meta-tool flow:
`get_tool_catalog` → `learn_tools` → `execute_tool{toolName, arguments}`;
`find_many_*` requires a `select: ["field", ...]` list.

**Support reply on the right channel.** Find the conversation in `chatwoot`
(pass `accountId`, usually 1), read the thread, reply there rather than
opening a new channel.

## Cautions

- Every send (email, WhatsApp, SMS, call, post) is a **write action —
  show the draft + audience and get explicit approval first**.
- Never paste tokens into chat; the gateway already holds default keys.
- Messaging real customers from a test prompt is unrecoverable — verify the
  recipient list before any broadcast tool call.
