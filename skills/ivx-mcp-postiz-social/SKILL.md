---
name: ivx-mcp-postiz-social
description: Schedule and analyze social-media posts (Instagram, X, LinkedIn, TikTok) through the Postiz wrapper MCP — list channels, find free slots, create/schedule posts, pull analytics. Use for any "post this / what's scheduled / how did the post do" request.
version: 1.0.0
metadata:
  hermes:
    tags: [mcp, postiz, social, schedule, instagram, twitter, linkedin, tiktok]
    related_skills: [ivx-mcp-talk-to-people, ivx-mcp-directory]
---

# Postiz — social scheduling

## What it is

Postiz (`https://postiz.intelli-verse-x.ai`) is the org's social calendar:
all connected accounts (Instagram, X, LinkedIn, TikTok, …) post from one
place. Agents drive it through a **stateless wrapper MCP** with the
Intelli Verse X org key baked in (Postiz's built-in MCP is deprecated —
its in-memory sessions were racy across replicas).

- Tile id: `postiz` (group "Talk to people")
- MCP endpoint: `https://postiz-mcp.intelli-verse-x.ai/`
- Auth: org key baked into the wrapper — no token needed.
  `admin_call_mcp { tileId: "postiz" }` just works.

## Key tools (from the registry)

| Tool | What it does |
|---|---|
| `postiz_list_integrations` | Connected social channels (get channel ids here first) |
| `postiz_list_posts` | Scheduled/published posts on the calendar |
| `postiz_find_slot` | Next free posting slot for a channel |
| `postiz_create_post` | Create/schedule a post (write) |
| `postiz_upload_from_url` | Attach media by URL |
| `postiz_analytics` | Post/channel performance |

## Worked example — "post our launch thread on X tomorrow morning"

1. `postiz_list_integrations` → find the X account's integration id.
2. `postiz_find_slot` for that channel around the requested time.
3. Draft the copy; if there's an image, `postiz_upload_from_url` first.
4. **Show draft + channel + exact time and get approval** — publishing is
   a write.
5. `postiz_create_post { integrationId, content, publishDate, media }`.
6. Confirm back with the scheduled time and the calendar entry; check
   `postiz_analytics` a day later if asked.

## Common failure modes

- **401/403** — the baked org key was rotated; report it (secret
  `postiz-mcp-secret` / gateway `admin-mcp-gateway-tokens`) rather than
  asking the user for a key in chat.
- **Post created but never publishes** — the target channel's OAuth to the
  social network expired; reconnect in the Postiz UI (portal tile
  `postiz-studio`). The MCP can't fix platform OAuth.
- **Wrong account posted** — multiple integrations per platform exist;
  always resolve the integration id from `postiz_list_integrations` by
  name, never assume.
- **Media rejected** — platform constraints (size/aspect/format) surface
  as create errors; re-encode and retry once, then escalate.

## Cautions

Posts go out publicly under the org's brand — draft-then-approve every
`postiz_create_post`, including "just reschedule it" edits. Never paste
API keys into chat.
