---
name: ivx-hermes-cloud-delegate
description: Delegate tasks to the Hermes cloud workers running in EKS (aicart namespace) and manage their lifecycle — create kanban cards via the card-intake API or kubectl exec, list/show progress, and cancel/delete tasks. Use when work should run in-cluster instead of on a laptop (long-running ops, admin actions, content-factory pipelines, ads), or when someone asks to send a task to "the cloud worker" / cancel one.
version: 1.0.0
metadata:
  hermes:
    tags: [hermes, kanban, delegate, cloud, eks, worker, card-intake, cancel]
    related_skills: [ivx-hermes-local, ivx-mcp-directory, ivx-agent-vault]
---

# Delegating tasks to the Hermes cloud workers (EKS)

## The workers

Three kanban dispatchers run in `aicart` (all from the shared
`hermes-worker` image; ECR `hermes-worker:latest`):

| Deployment | Board | Purpose | Front door |
|---|---|---|---|
| `hermes-worker` | `content-factory` | CF pipeline ops swarm | `kubectl exec` only |
| `hermes-admin-worker` | `admin-actions` | approved admin actions (Insights Engine) | card-intake HTTP API :8090 |
| `hermes-ads-worker` | `ads` | ads ops (scaled to 0 unless campaigning) | `kubectl exec` only |

Each pod has its **own PVC** (own SQLite kanban DB) — that is the isolation
boundary, not the board name. The daemon dispatches tasks with
`status=ready AND assignee IS NOT NULL`; cards without an assignee sit
forever, so always set one (`default` = the pod's built-in profile).

Workers ship with: git+gh (org repo access via `GITHUB_TOKEN`), kubectl
(in-cluster SA), aws CLI, the admin-mcp gateway in `config.yaml`
(`ADMIN_MCP_TOKEN` → every admin portal tool), self-hosted Firecrawl
(`FIRECRAWL_API_URL` cluster-local), and the full `ivx-*` skills bundle
from `intelli-verse-x/agent-skills` (refreshed every pod start).

## Path A — card-intake HTTP API (admin-actions board)

In-cluster service: `http://hermes-admin-card-intake.aicart.svc.cluster.local:8090`.
Auth: `Authorization: Bearer $CARD_INTAKE_TOKEN`
(Secret `hermes-admin-worker-secrets/CARD_INTAKE_TOKEN`).

### Create (delegate) a task

```bash
curl -sS -X POST http://hermes-admin-card-intake.aicart.svc.cluster.local:8090/cards \
  -H "Authorization: Bearer $CARD_INTAKE_TOKEN" -H 'Content-Type: application/json' \
  -d '{
    "title": "[P1] quizverse: investigate D1 retention drop",
    "body": "<full worker prompt: context + evidence + tool plan + completion instructions>",
    "assignee": "default",
    "priority": 2,
    "idempotencyKey": "my-task-2026-07-09-001",
    "skills": ["ivx/mcp-directory"]
  }'
# -> 201 {"id": "<task-id>", "status": "ready", ...}
```

Always pass an `idempotencyKey` so retries don't double-create. `skills`
become `--skill` flags on the spawned worker.

### List / inspect

```bash
curl -sS http://…:8090/cards          -H "Authorization: Bearer $CARD_INTAKE_TOKEN"   # list
curl -sS http://…:8090/cards/<id>     -H "Authorization: Bearer $CARD_INTAKE_TOKEN"   # show + events
```

### Cancel / delete a task

```bash
curl -sS -X DELETE http://…:8090/cards/<id> -H "Authorization: Bearer $CARD_INTAKE_TOKEN"
# -> 200 {"id": "...", "archived": true, "previousStatus": "running"}
```

Semantics: if the task is `running` the claim is reclaimed first (the
worker subprocess is released), then the card is **archived** — the
kanban's terminal removed state, recoverable and auditable. Permanent
purge stays a manual pod-side action:
`hermes kanban archive --rm <id>` after archiving.

From outside the cluster, port-forward first:

```bash
kubectl port-forward -n aicart svc/hermes-admin-card-intake 8090:8090
```

## Path B — kubectl exec (any board, incl. content-factory / ads)

```bash
# create
kubectl exec -n aicart deploy/hermes-worker -c hermes-worker -- \
  hermes kanban --board content-factory create "title" \
  --assignee default --priority 1 --body "<prompt>" --json

# list / show / tail
kubectl exec -n aicart deploy/hermes-worker -c hermes-worker -- \
  hermes kanban --board content-factory list --json
kubectl exec -n aicart deploy/hermes-worker -c hermes-worker -- \
  hermes kanban --board content-factory show <id>

# cancel: reclaim a running claim, then archive (delete)
kubectl exec -n aicart deploy/hermes-worker -c hermes-worker -- \
  hermes kanban --board content-factory reclaim <id> --reason "cancelled"
kubectl exec -n aicart deploy/hermes-worker -c hermes-worker -- \
  hermes kanban --board content-factory archive <id>
```

## Monitoring a delegated task

```bash
kubectl logs -n aicart deploy/hermes-admin-worker -c hermes-admin-worker -f | grep <task-id>
```

Completion contract: workers mark the card done on the board via the
`kanban_complete` tool; any external callback (e.g. Insights Engine
approve→done webhook) must be written INTO the card body as a curl
instruction with a scoped one-time token.

## Choosing local vs cloud

Delegate to the cloud worker when the task is long-running, needs
in-cluster network access (cluster-local MCPs, CockroachDB, CF API), must
survive your laptop sleeping, or is an approved admin action. Run locally
(`ivx-hermes-local`) for interactive/iterative work.
