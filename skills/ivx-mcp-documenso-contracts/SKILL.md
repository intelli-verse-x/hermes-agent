---
name: ivx-mcp-documenso-contracts
description: Send documents for e-signature and track signing via the Documenso MCP — full lifecycle from template or uploaded PDF through recipients, fields, send, and download. Use for contracts, NDAs, and agreements.
version: 1.0.0
metadata:
  hermes:
    tags: [mcp, documenso, esign, contracts, signature, agreements]
    related_skills: [ivx-mcp-commerce, ivx-mcp-directory]
---

# Documenso — e-signatures & contracts

## What it is

Documenso (`https://contracts.intelli-verse-x.ai`) is the org's
self-hosted e-signature platform. The MCP covers the full document
lifecycle: templates, PDF uploads, recipients, signature fields,
sending/resending, downloads, direct links, and folders.

- Tile id: `documenso` (group "Commerce")
- MCP endpoint: `https://documenso-mcp.intelli-verse-x.ai/`
- Auth: `Authorization: Bearer <team-scoped Documenso API token>`
  (Settings → API Tokens). Gateway default is wired —
  `admin_call_mcp { tileId: "documenso" }` needs no token.

## Key tools (from the registry)

| Tool | What it does |
|---|---|
| `documenso_list_templates` | House templates (start here for standard contracts) |
| `documenso_get_template` | Template detail: its recipients/placeholders |
| `documenso_use_template` | Instantiate: `{ recipients, formValues, prefillFields }` |
| `documenso_upload_document` | Upload your own PDF: `{ fileUrl \| fileBase64 }` |
| `documenso_add_fields` | Place signature/date/text fields for recipients |
| `documenso_send_document` | Send for signature (write — emails signers) |
| recipients/fields CRUD, resend, download, direct links, folders | Discover exact names via `tools/list` |

## Worked example — "send the standard NDA to jane@acme.com"

Template path (house contract):
1. `documenso_list_templates` → find the NDA template id.
2. `documenso_get_template` → see required `formValues`/`prefillFields`
   and recipient roles.
3. `documenso_use_template { recipients: [{ name, email }], formValues,
   prefillFields }` → returns the draft document id.
4. **Show recipient + document title, get approval.**
5. `documenso_send_document` → report the signing link/status.

Own-PDF path: `documenso_upload_document { fileUrl | fileBase64 }` →
`documenso_add_fields` → `documenso_send_document`. **PDFs only** —
convert Word/Google Docs first.

## Common failure modes

- **401 Unauthorized** — token missing/rotated, or it's a personal token
  where a **team-scoped** token is required (team tokens see the team's
  templates; personal ones don't).
- **Template found but `use_template` fails** — missing required
  `formValues`/recipient roles; re-read `documenso_get_template` for the
  exact placeholder names.
- **Upload rejected** — non-PDF payload or oversized base64; prefer
  `fileUrl` for big files.
- **Signer never got the email** — check recipient email spelling and the
  document status (draft vs pending); resend only after confirming, since
  resends email real people.

## Cautions

`documenso_send_document`, resends, and recipient changes email real
counterparties and create legally meaningful artifacts — always show
recipients + document before sending. Signed documents may contain
sensitive terms: link/download for the user, don't paste contents into
shared channels. Never paste API tokens into chat.
