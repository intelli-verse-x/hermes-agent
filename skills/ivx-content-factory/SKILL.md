---
name: ivx-content-factory
description: How to use the Content Factory MCP servers from Hermes — when to pick a "pipeline" vs a "media primitive", how to poll for task status, how to find the right pipeline name from 50+ options, and how to surface produced artifacts back to the user. Use whenever the user asks to "generate"/"produce"/"create"/"render" any video, image set, podcast, ad, screenshot batch, song, dub, or other media via Content Factory.
version: 1.0.0
metadata:
  hermes:
    tags: [content-factory, video, image, audio, mcp, generation]
    related_skills: [ivx-content-factory-pipeline, ivx-stack-tour]
---

# Content Factory — the playbook from Hermes

## When to use this skill

- User asks for media generation by category ("make a trailer for X",
  "generate ad banners for Y", "narrate this blog as a podcast").
- User asks "what pipelines are available?".
- Status checks on a running task.
- Listing produced artifacts.

## The two MCP servers

Both are pre-wired in your `~/.hermes/config.yaml`:

| MCP server | When to use |
|---|---|
| `content-factory` | Run a *named pipeline*. Each pipeline knows the right sequence of writer → director → producer → editor steps to produce a finished artifact (a learning series episode, an ad video, a screenshot batch, a podcast). |
| `content-factory-media` | Run a *single primitive*: `generate_image`, `generate_video`, `generate_tts`, `generate_music`, `generate_motion`. Use when you want one asset and don't need a full pipeline. |

If in doubt: ask which one's right by reading the pipeline list.

## The 50+ pipelines

You don't need to memorize them — call `mcp_content_factory_list_pipelines`
on the first use of this skill in a session and cache the answer. Common
names:

- **Long form video**: `learning_series`, `movie`, `kids_movie`,
  `short_movie`, `documentary`, `event_recap`.
- **Short form video**: `short_video`, `video_shorts`, `quiz_shorts`,
  `game_trailer`, `app_ad_campaigns`, `event_promo`.
- **Audio-first**: `podcast_series`, `podcast2video`, `song`, `dubbing`.
- **Visual assets**: `ad_banners`, `app_store_deployer`, `marketing_kit`,
  `world_scene`.
- **Strategy artifacts**: `gtm_master_plan`, `revenue_strategy`,
  `game_marketing_audit`.

## The workflow

1. **Pick the pipeline.** If the user named one, use it. Otherwise pick the
   closest match and confirm in one line.
2. **File the bead first.** Every Content Factory run should be a bead so
   the artifacts are auditable.
   ```
   bd create "CF: <pipeline_name> for <subject>" --type=task
   bd update <id> --metadata '{"pipeline":"<name>","requested_by":"<user>"}'
   ```
3. **Kick off the pipeline.** Call
   `mcp_content_factory_run_pipeline(pipeline=<name>, params={...})`.
   This returns a `task_id` immediately — pipelines are async.
4. **Poll.** `mcp_content_factory_get_task_status(task_id=<id>)`. Long
   pipelines (movies, learning_series) can take 20+ minutes. Surface a
   progress estimate to the user.
5. **Surface artifacts.** When `status == "completed"`, the response
   includes S3 URLs, captions, thumbnails. Post them back to the user
   *and* close the bead with `pr_url` / `playbook_path` pointing at the
   artifact manifest.

## When to escalate

If a pipeline fails twice in a row, **don't run it a third time.** That's a
classic agent failure mode (wasted compute, stuck loop). Instead:

```
POST https://n8n.intelli-verse-x.ai/webhook/gt-escalate
{
  "bead":     "<id>",
  "role":     "hermes",
  "severity": "p1",
  "reason":   "content-factory pipeline <name> failed twice",
  "detail":   "<stack trace + last status payload>",
  "links":    {"bead": "<URL>", "task_id": "<id>"}
}
```

A human will pick it up in Discord.

## Cost-aware defaults

Some pipelines (movies, learning_series, big documentaries) cost real GPU
time. Default to **the cheapest equivalent** unless the user explicitly
asks for high-quality:

- `short_video` over `short_movie`
- `quiz_shorts` over `video_shorts` for quiz content
- `podcast2video` (single voice) over `podcast_series` for one-off audio

The user can always ask for the bigger one. Defaulting cheap saves them
money on speculative generation.

## What NOT to do

- Don't re-run a pipeline on top of an in-progress one for the same input.
  Check status first.
- Don't fetch the resulting S3 URLs into your context — link to them.
  Hermes context windows are small; CF artifacts are gigabytes.
- Don't run media primitives in a tight loop to "build" a pipeline by
  hand. If you need a fixed sequence, file a bead asking for a new named
  pipeline in `content-factory/configs/pipelines/`.
