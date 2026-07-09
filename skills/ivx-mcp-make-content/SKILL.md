---
name: ivx-mcp-make-content
description: The "Make content" MCP tiles — Google Stitch UI design, QR Studio codes & landing pages, OpenSEO keyword research, and Firecrawl web scraping. Use when creating design mockups, QR campaigns, SEO research, or scraping the web for source material.
version: 1.0.0
metadata:
  hermes:
    tags: [mcp, content, design, qr, seo, scraping, firecrawl, stitch]
    related_skills: [ivx-mcp-directory, ivx-content-factory]
---

# Make content — creation & research MCPs

## When to use this skill

- Designing app screens / web UIs from a prompt (Stitch).
- Creating or retargeting QR codes, their landing pages, scan analytics.
- Keyword research, SERP checks, rank tracking (OpenSEO).
- Scraping any webpage to markdown, web search, whole-site crawls (Firecrawl).

For **video/image/audio generation pipelines**, use the Content Factory MCPs
instead — see the `ivx-content-factory` skill (gateway tileId
`content-factory`, endpoint `https://agent-mcp.intelli-verse-x.ai/mcp`).

## The tiles in this group

Registry group `make-content`. Gateway tileId is what `admin_call_mcp` takes.

| Tile id | Gateway tileId | What it does | Auth / key tools |
|---|---|---|---|
| `stitch` | `stitch` | Google Stitch official MCP — generate/edit app screens from text, export HTML/CSS | Header `X-Goog-Api-Key` = Stitch API key (platform default wired). Tools: `list_projects`, `create_project`, `list_screens`, `get_screen`, `generate_screen_from_text`, `edit_screens`. Generation **spends credits — confirm first**. |
| `qrstudio` | `qrstudio` | QR Studio wrapper (31 tools): dynamic/static QRs, styling, bulk CSV, landing pages, scan analytics, webhooks | Service-account JWT baked; no token. In-cluster only. Start with `qr_list`/`qr_get`; create/update/delete with `qr_create`/`qr_update`/`qr_delete`; previews `qr_preview`/`qr_render`; analytics `qr_analytics_overview/timeseries/breakdown`; landing pages `qr_landing_get/upsert`; assets `qr_asset_upload_presign` → `qr_asset_confirm`. |
| `open-seo` | `open-seo` | OpenSEO: keyword research, SERP, domain overview, rank tracker | Self-hosted at `https://seo.toba-tech.ai/mcp`, no token. |
| `firecrawl` | `firecrawl` | Firecrawl official MCP: scrape URL → markdown, web search, site map/crawl, structured extraction | Bearer = Firecrawl API key (`fc-...`), platform default wired. Tools: `firecrawl_scrape{url, formats:["markdown"]}`, `firecrawl_search{query}`, `firecrawl_map`, `firecrawl_crawl`, `firecrawl_extract`. |

Portal-only tiles (no MCP — launch the UI): `content-factory` (video
pipeline front door), `blog-keywords` (SEO keyword planner for the 6 blog
sites), `animator` (Manim), `tutor` (DeepTutor), `smartlink` (short links),
`open-webui`, `ai-chat-v2`, plus internal shells (`cf-director`,
`cf-videoagent`, `ai-host`, `ai-voice`, `qr-app`, `content-factory-mobile`).

## How to reach them

**Direct attach:** `https://stitch.googleapis.com/mcp` (X-Goog-Api-Key),
`https://seo.toba-tech.ai/mcp` (no auth), `https://mcp.firecrawl.dev/v2/mcp`
(Bearer fc-key). `qrstudio` is in-cluster only.

**Gateway** (works for all four, tokens pre-wired):

```
admin_call_mcp { tileId: "firecrawl", method: "tools/call",
                 tool: "firecrawl_scrape",
                 arguments: { url: "https://example.com", formats: ["markdown"] } }
```

## Task recipes

**Competitor research → brief.** `firecrawl_search` for the competitor →
`firecrawl_scrape` their pricing/landing pages → summarize into a brief.
For multi-page: `firecrawl_map` first, then scrape the interesting URLs.

**SEO content plan.** OpenSEO keyword research on the seed term → check
SERPs for the top candidates → hand the winning keywords to the blog
pipeline (portal tile `blog-keywords`) or a content skill.

**QR campaign with a landing page.** `qr_create` (dynamic, so it stays
retargetable after printing) → `qr_landing_upsert` for the hosted page →
share `qr_image_url`/`qr_download_url` → later check `qr_analytics_overview`.

**UI mockup.** `list_projects` → `create_project` if needed →
`generate_screen_from_text{projectId, prompt}` (confirm first — credits) →
iterate with `edit_screens` → export HTML from `get_screen`.

## Cautions

- Stitch generation and Firecrawl crawls consume paid credits — confirm
  before large jobs (a full `firecrawl_crawl` of a big site is expensive).
- QR writes (`qr_create/update/delete`, landing/webhook/API-key/asset
  writes) need user confirmation; a deleted dynamic QR kills printed codes.
- Never paste API keys into chat; defaults are already wired.
