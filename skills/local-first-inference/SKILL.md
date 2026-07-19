---
name: local-first-inference
description: Route inference locally when available while enforcing privacy, safe escalation, and measured savings. Use for model selection, routing, retries, evaluation, or cost reporting.
version: 1.0.0
metadata:
  tags: [local, inference, privacy, routing, cost]
---

# Local-First Inference

Runtime code and live status are authoritative; this skill never overrides them.

## Procedure

1. Inspect the current policy, local runtime status, model capabilities, context limit, required tools, and request sensitivity. Do not infer readiness from configuration alone.
2. Use local inference when policy permits and the runtime reports it can satisfy the request. Treat unavailable, unsupported, over-context, or failed local execution according to the runtime's route decision.
3. Honor `local-only` and privacy constraints as hard boundaries. If local execution cannot proceed, block and explain why; never send prompts, responses, tool arguments, or sensitive context to cloud services.
4. Do not use a cloud model as a judge for local output. Prefer deterministic validation, tool/schema checks, and local evaluation. A judge call is still a cloud disclosure and cost.
5. Escalate only when policy permits and runtime routing authorizes it. Send the smallest sufficient recent context, omit secrets and unrelated history, and state that cloud processing will occur when user consent is required.
6. Follow explicit cloud or frontier requests only within policy. Never silently retry in cloud after a local failure.

## Reporting

- Report the route and runtime-provided reason; distinguish observed status from assumptions.
- Claim savings only from authoritative measured counters or billing data. State the baseline, units, and period.
- Never equate local requests with money saved, invent token prices, or count blocked/failed work as savings. If measurements are unavailable, say savings are unknown.

## Safety Check

Before responding, verify that local-only data stayed local, no cloud judge ran, escalation was minimal and authorized, and every savings claim is reproducible from runtime data.
