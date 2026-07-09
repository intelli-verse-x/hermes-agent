---
name: ivx-agent-vault
description: How to fetch secrets from Infisical (the Agent Vault pattern) at runtime instead of reading them from baked-in env vars / k8s secrets. Use this whenever an agent needs a credential and the operator wants rotation+audit+per-secret access control. The benefit over plain env: rotate one secret in Infisical UI/API and every agent sees the new value within seconds, no redeploy.
version: 1.0.0
metadata:
  hermes:
    tags: [infisical, secrets, agent-vault, security, rotation]
    related_skills: [ivx-stack-tour]
---

# Agent Vault — fetching secrets from Infisical at runtime

## When to use this skill

- You need a credential that should be rotatable without a redeploy.
- You want per-machine-identity audit logging on the secret access.
- You want different agents to have different access scopes (mayor can
  read DISCORD_BOT_TOKEN, the seo polecat cannot).

If the secret is constant and shared by every agent (e.g. the LiteLLM
gateway URL), keep it as plain env. Agent Vault is for tokens that
matter.

## The setup (already done)

Infisical is live at `https://infisical.intelli-verse-x.ai`. We
bootstrapped it headlessly via `/api/v1/admin/bootstrap` so there's:

- An admin user `ops@intelli-verse-x.ai`
- A **machine-identity token** stored in
  `kubectl get secret infisical-admin -n aicart -o jsonpath='{.data.MACHINE_IDENTITY_TOKEN}' | base64 -d`
- Five projects: `gastown`, `hermes`, `content-factory`, `n8n-flows`, `finance`.
- All representative cluster secrets pushed into the matching project's
  `prod` environment.

## The read pattern

From a shell:

```bash
INFISICAL_URL=https://infisical.intelli-verse-x.ai
TOKEN=$(kubectl get secret infisical-admin -n aicart \
  -o jsonpath='{.data.MACHINE_IDENTITY_TOKEN}' | base64 -d)

# Lookup the project ID once (cache it).
PROJECT_ID=$(curl -fsS -H "Authorization: Bearer $TOKEN" \
  "$INFISICAL_URL/api/v2/workspace?type=secret-manager" \
  | jq -r '.workspaces[] | select(.name=="hermes") | .id')

# Read a single secret.
curl -fsS -H "Authorization: Bearer $TOKEN" \
  "$INFISICAL_URL/api/v3/secrets/raw/LITELLM_API_KEY?workspaceId=${PROJECT_ID}&environment=prod" \
  | jq -r '.secret.secretValue'
```

From Python (Hermes plugins, Bernstein adapters):

```python
import os, requests
INFISICAL = os.environ["INFISICAL_BASE_URL"]
TOKEN     = os.environ["INFISICAL_MACHINE_IDENTITY_TOKEN"]
def read_secret(project, name, env="prod"):
    pid = requests.get(
        f"{INFISICAL}/api/v2/workspace?type=secret-manager",
        headers={"Authorization": f"Bearer {TOKEN}"}, timeout=10,
    ).json()
    pid = next(w["id"] for w in pid["workspaces"] if w["name"] == project)
    r = requests.get(
        f"{INFISICAL}/api/v3/secrets/raw/{name}",
        params={"workspaceId": pid, "environment": env},
        headers={"Authorization": f"Bearer {TOKEN}"}, timeout=10,
    ).json()
    return r["secret"]["secretValue"]

litellm_key = read_secret("hermes", "LITELLM_API_KEY")
```

From Node (n8n custom nodes, leantime-mcp):

```js
const fetch = require('node-fetch');
const INFISICAL = process.env.INFISICAL_BASE_URL;
const TOKEN     = process.env.INFISICAL_MACHINE_IDENTITY_TOKEN;
async function readSecret(project, name, env='prod') {
  const ws = await (await fetch(`${INFISICAL}/api/v2/workspace?type=secret-manager`,
    { headers: { Authorization: `Bearer ${TOKEN}` }})).json();
  const pid = ws.workspaces.find(w => w.name === project).id;
  const r = await (await fetch(
    `${INFISICAL}/api/v3/secrets/raw/${name}?workspaceId=${pid}&environment=${env}`,
    { headers: { Authorization: `Bearer ${TOKEN}` }})).json();
  return r.secret.secretValue;
}
```

## Caching

Don't fetch on every call. The pattern: **fetch once at startup, cache
for the process lifetime, refresh on 401**. The most common bug is to
fetch the secret inside a tight loop and hammer Infisical (~rate-limit
50 req/s per machine identity).

## Rotation flow

```
1. Operator (or rotation cron): mint new LITELLM_API_KEY virtual key via
   LiteLLM /key/generate.
2. Write it into Infisical:
   curl -X PATCH "$INFISICAL/api/v3/secrets/raw/LITELLM_API_KEY?..." -d '{secretValue:"sk-new..."}'
3. Each agent pre-flights once a minute (or on 401); next read picks up
   the new value.
4. Old key auto-disabled after a 5-min grace window via LiteLLM /key/delete.
```

Total agent disruption: zero. No redeploy. No env-var bump.

## When NOT to use this

- **Bootstrap secrets** (the secret you'd use to FETCH from the vault).
  Those still have to live in plain k8s secrets — the chicken-and-egg.
- **One-shot scripts** that don't justify a network round-trip. A
  bootstrap script that runs once at deploy can use `kubectl get secret`
  directly.
- **Secrets the agent needs offline** (e.g. for an air-gapped pod). The
  vault is online-only.
