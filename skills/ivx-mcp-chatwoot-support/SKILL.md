---
name: ivx-mcp-chatwoot-support
description: Triage and reply to customer conversations in Chatwoot (the org's shared inbox for email, chat, and social) via its MCP. Use for support-queue summaries, finding a customer's thread, and drafting/sending replies.
version: 1.0.0
metadata:
  hermes:
    tags: [mcp, chatwoot, support, inbox, helpdesk, triage]
    related_skills: [ivx-mcp-talk-to-people, ivx-mcp-directory]
---

# Chatwoot — shared-inbox support triage

## What it is

Chatwoot (`https://inbox.intelli-verse-x.ai`) is the omnichannel shared
inbox: customer email, live chat, and social DMs all land here as
conversations with agents, labels, and statuses.

- Tile id: `chatwoot` (group "Talk to people")
- MCP endpoint: `https://chatwoot-mcp.intelli-verse-x.ai/`
- Auth: `Authorization: Bearer <Chatwoot access token>` (Profile → Access
  Token). Gateway default is wired — `admin_call_mcp { tileId: "chatwoot" }`
  works with no token.

## Key tools

The registry doesn't enumerate this wrapper's tools — discover them:

```
admin_call_mcp { tileId: "chatwoot", method: "tools/list" }
```

Expect conversation listing/reading/replying and contact tools. **Most
tools require an `accountId` argument** (the org account is usually `1`);
if a call errors about a missing account, that's why.

## Worked example — "summarize the open support queue and reply to the angry one"

1. `tools/list` → identify the conversation-list tool.
2. `tools/call` list conversations `{ accountId: 1, status: "open" }`.
3. Summarize: count by inbox/label, oldest unanswered, anything with
   escalation keywords.
4. For the flagged conversation: fetch its messages, draft a reply,
   **show the draft to the user** — sending a reply is a write.
5. On approval: `tools/call` the reply tool with the conversation id.
6. Report: queue summary + link `https://inbox.intelli-verse-x.ai` for
   the rest.

## Common failure modes

- **401 Unauthorized** — the access token is wrong/expired, or you attached
  directly without a Bearer. Fall back to the gateway (default wired).
- **Missing/invalid accountId** — most tools need it; use account `1`
  unless told otherwise.
- **Empty results but the inbox shows conversations** — check the status
  filter (open vs pending vs resolved) and the inbox scope of the token's
  agent.
- **Reply lands in the wrong channel** — reply within the existing
  conversation; never open a new outbound channel (email/WhatsApp) for a
  thread that lives in Chatwoot.

## Cautions

Replies and status changes (resolve, snooze, assign) are writes to real
customer threads — draft-then-approve, and never paste the access token
into chat.
