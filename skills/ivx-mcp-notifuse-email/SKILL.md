---
name: ivx-mcp-notifuse-email
description: Send marketing email and push campaigns and track opens via the Notifuse MCP (workspace intelliversex). Use for newsletters, product announcements, campaign stats, and list management.
version: 1.0.0
metadata:
  hermes:
    tags: [mcp, notifuse, email, push, campaign, newsletter, marketing]
    related_skills: [ivx-mcp-talk-to-people, ivx-mcp-directory]
---

# Notifuse — email & push campaigns

## What it is

Notifuse (`https://notifuse.intelli-verse-x.ai`) is the org's campaign
engine: marketing email + push notifications with contact lists,
templates, broadcasts, and open/click tracking. The org workspace is
`intelliversex`.

- Tile id: `notifuse` (group "Talk to people")
- MCP endpoint: `https://notifuse-mcp.intelli-verse-x.ai/mcp` (note `/mcp`)
- Auth: `Authorization: Bearer <Notifuse API key>`. The workspace key is
  pre-authed **at the gateway** (`admin-mcp-gateway-tokens`), so
  `admin_call_mcp { tileId: "notifuse" }` needs no token.

## Key tools

The registry doesn't enumerate this server's tools — discover them:

```
admin_call_mcp { tileId: "notifuse", method: "tools/list" }
```

Expect list/contact management, template, broadcast/campaign send, and
stats tools ("List the Notifuse lists in the intelliversex workspace" is
the canonical smoke test).

## Worked example — "send the July product update to the newsletter list"

1. `tools/list` → identify list, template, and broadcast tools.
2. List the contact lists → confirm which one ("newsletter") and its size.
3. Draft subject + body (or pick the existing template).
4. **Show draft + audience count and stop for approval** — a broadcast to
   a real list is irreversible.
5. Send/schedule the broadcast via the broadcast tool.
6. Report the campaign id; pull open/click stats after 24h if asked.

## Common failure modes

- **401 Unauthorized** — wrong/rotated API key, or you attached directly
  without the Bearer. Use the gateway path; if that also 401s, the gateway
  default token needs re-seeding (report it, don't ask for keys in chat).
- **Workspace mismatch** — tools operate in the key's workspace
  (`intelliversex`); if a list you expect is missing, you're in the wrong
  workspace, not an empty account.
- **Broadcast "sent" but nothing arrives** — check the sending domain /
  SMTP integration status in the Notifuse UI; the MCP can't repair DNS or
  SMTP config.
- **Template variables unrendered** (`{{name}}` in the received mail) —
  the list's contact fields don't match the template variables; verify
  field names before sending.

## Cautions

Broadcasts hit real subscriber inboxes and affect sender reputation —
always confirm audience + content first, never send test blasts to
production lists, and never paste the API key into chat.
