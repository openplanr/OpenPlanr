<!-- agents/modes/default/devops.md: default-mode-only content for devops-agent. Loaded by agents/devops-agent.md when MODE=default. T-002 of SPEC-002. -->

> **Mode:** default
> **Loaded by:** `agents/devops-agent.md` when the orchestrator passes `MODE=default` (no `SPEC_DIR`).

## Path Resolution

devops-agent's only mode-specific input is the QA gate location. In default mode the orchestrator (`/ship`) reads the QA report from the feature folder:

- QA report (gate): `output/feats/feat-${ARGUMENTS}/qa-report.md` — must show "Verdict: PASS" before this agent runs.

All output paths (`docker-compose.yml`, `.env.example`, `Dockerfile.*`, `.github/workflows/ci.yml`) are project-root paths and are mode-agnostic.

---

## Inputs

| Input | Source | Required |
|-------|--------|----------|
| `input/tech/stack.md` | Tech Lead | Yes |
| `${CLAUDE_PLUGIN_ROOT}/stacks/devops/docker-compose.md` | Stack library | Yes |
| `output/feats/feat-{name}/qa-report.md` | QA Agent | Yes (must show PASS) |
| `output/db/schema.json` | DB Agent | For DB service config |

---

## Execution Steps (mode-specific bits)

```
0. Receive feature name from /planr-pipeline:ship as $ARGUMENTS (used for log context only)
1. Verify QA gate passed (read output/feats/feat-$ARGUMENTS/qa-report.md → "Verdict: PASS")
   If FAIL: skip silently, log warning
```

The remaining steps (load stack, generate compose/env/Dockerfile/CI) are mode-agnostic and live in the entry file.

---

## Error Handling (mode-specific paths)

| Error | Response |
|-------|----------|
| QA gate FAIL | Skip silently, log: "DevOps Agent skipped — QA gate did not pass" |
| `output/feats/feat-{name}/qa-report.md` missing | Skip silently, log: "DevOps Agent skipped — no QA report found" |

---

*Reads: stack.md · `${CLAUDE_PLUGIN_ROOT}/stacks/devops/*.md` · `output/feats/feat-{name}/qa-report.md` · schema.json*
*Writes: docker-compose.yml · .env.example · Dockerfiles · CI workflow*
*Does NOT deploy — per framework non-goals*
