<!-- agents/shared/modes/default/devops.md: default-mode-only content for devops-agent. Loaded by agents/devops-agent.md when MODE=default. T-002 of SPEC-002. -->

> **Mode:** default
> **Loaded by:** `agents/devops-agent.md` when the orchestrator passes `MODE=default` (no `SPEC_DIR`).

## Context locations

Use the request and current repository as primary context. When present, default
planning context lives under `output/feats/feat-${ARGUMENTS}/`; stack context
lives at `input/tech/stack.md`, and database context may live at
`output/db/schema.json`. These files are useful inputs, not prerequisites.

Infrastructure outputs normally remain at project-owned paths such as
`docker-compose.yml`, `.env.example`, `Dockerfile.*`, and
`.github/workflows/ci.yml`.

---

## Inputs

| Input | Source | Required |
|-------|--------|----------|
| Explicit request and existing infrastructure files | User / repository | Primary |
| `input/tech/stack.md` | Tech Lead | When present |
| Relevant `${CLAUDE_PLUGIN_ROOT}/stacks/devops/*.md` file | Stack library | When it matches the stack |
| `output/feats/feat-{name}/` | Planning context | When useful |
| `output/db/schema.json` | DB Agent | When DB service configuration is needed |

---

## Mode guidance

```
1. Locate the application services, existing infrastructure files, package/build
   commands, and any useful feature context.
2. Apply the entry agent's infrastructure guidance to the artifacts relevant to
   the requested outcome.
3. Check internal consistency in proportion to the change and report the result.
```

---

## Error Handling (mode-specific paths)

| Error | Response |
|-------|----------|
| Planning or stack artifact missing | Infer from repository configuration when safe and state material assumptions |
| Database context missing | Avoid inventing database settings; use established configuration or flag the missing choice |
| Existing infrastructure is hand-customized | Preserve intentional edits and make the smallest coherent change |

---

*Reads: request · current infrastructure · package/build config · relevant stack/planning/schema context*
*Writes: docker-compose.yml · .env.example · Dockerfiles · CI workflow*
*Does NOT deploy — per framework non-goals*
