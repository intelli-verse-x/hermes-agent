---
name: ivx-mcp-commerce
description: The "Commerce" MCP tiles — Documenso e-signatures is the one MCP-drivable tile; the rest (cashback quests, coupons, gift cards, fraud queue, merch) are admin-portal pages, with the QuestX rewards engine reachable via the game-ops `quests` MCP. Use for contracts and commerce-program admin.
version: 1.0.0
metadata:
  hermes:
    tags: [mcp, commerce, contracts, esign, cashback, rewards]
    related_skills: [ivx-mcp-directory, ivx-mcp-documenso-contracts, ivx-mcp-game-ops]
---

# Commerce — contracts & commerce-program MCPs

## When to use this skill

- Sending a document for e-signature or checking signing status (Documenso).
- Anything about the cashback/rewards program (quests, offers, coupons,
  gift cards, fraud review) — mostly portal pages, but the underlying
  QuestX engine has ~120 MCP tools via the `quests` tile (group Game ops).

## The tiles in this group

Registry group `commerce`. Only one tile has an MCP endpoint:

| Tile id | Gateway tileId | What it does | Auth |
|---|---|---|---|
| `documenso` | `documenso` | E-signatures & contracts: templates, uploads, recipients, fields, send/resend, download, direct links, folders | Bearer = team-scoped Documenso API token (Settings → API Tokens); default wired at gateway. Endpoint `https://documenso-mcp.intelli-verse-x.ai/`. |

Portal-only tiles (no MCP — launch the admin UI):

| Tile id | What it does |
|---|---|
| `quest-management` | Create/manage cashback quests and offers |
| `preset-rewards` | Preset quest reward templates |
| `coupon-rewards` | Coupon-based reward configuration |
| `affiliate-networks` | Affiliate network connections powering cashback |
| `brand-approvals` | Approve/reject brands entering the program |
| `partner-stores` | Partner store directory |
| `coupon-review` | Review queue for submitted coupons |
| `gift-card-review` | Review queue for gift card redemptions |
| `missing-cashback` | User-reported missing cashback claims |
| `fraud-queue` | Flagged transactions awaiting fraud review |
| `merch-orders` | Merch order management & fulfillment |
| `ivx-token` | IVX token administration |
| `kiosk`, `platform-user-frontend`, `beta-frontend`, `intelli-verse-x-root` | Customer-facing frontends for QA/preview |

**Programmatic path for the rewards economy:** the QuestX engine behind
these portal pages is `admin_call_mcp { tileId: "questx" }` (~120 tools:
brands, quests, offers, redemptions, gift cards, staking, coupons, fraud
checks). See the `ivx-mcp-game-ops` skill.

## How to reach Documenso

**Direct:** `https://documenso-mcp.intelli-verse-x.ai/` with
`Authorization: Bearer <Documenso API token>`.

**Gateway (token pre-wired):**

```
admin_call_mcp { tileId: "documenso", method: "tools/list" }
```

## Task recipes

**Send a house contract from a template.**
`documenso_list_templates` → `documenso_get_template` →
`documenso_use_template { recipients, formValues, prefillFields }` →
`documenso_send_document`. Show the recipient list before sending.

**Send your own PDF.** `documenso_upload_document { fileUrl | fileBase64 }`
(PDFs only — convert Word first) → `documenso_add_fields` (signature/date
fields per recipient) → `documenso_send_document`.

**Chase an unsigned contract.** Find the document, check recipient status,
then resend (`documenso_resend`-style tool from `tools/list`) — resending
emails the signer, so confirm first.

**Review a redemption/fraud case end-to-end.** Pull the case data via
`questx` tools (redemptions, fraud checks), summarize the evidence, and
link the operator to the matching portal review queue
(`/admin/gift-card-review`, `/admin/fraud-queue`) for the final decision.

## Cautions

- `documenso_send_document` and resends **email real signers** — always
  show recipients + document title and get approval first.
- Documenso accepts PDFs only; convert other formats before upload.
- Approve/reject decisions in the review queues are human calls — prepare
  the evidence, don't auto-decide.
- Never paste API tokens into chat; the gateway default is already wired.
