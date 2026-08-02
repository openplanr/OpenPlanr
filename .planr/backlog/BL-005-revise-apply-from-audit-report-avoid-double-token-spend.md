---
id: "BL-005"
title: "planr revise: apply from existing dry-run audit report to avoid double token spend"
priority: "high"
tags: ["feature", "revise", "cost", "dx", "ai", "performance"]
status: "open"
created: "2026-04-22"
updated: "2026-04-22"
---

# BL-005: planr revise: apply from existing dry-run audit report to avoid double token spend

## Priority
HIGH

## Tags

- feature
- revise
- cost
- dx
- ai
- performance

## Description

### Problem (observed in production)

The standard workflow for `planr revise` is **dry-run → review → apply**. Today that costs roughly **2× the token spend** of a single run, because the apply phase re-invokes the model on every non-skipped artifact from scratch. Real example on EPIC-004 cascade (27 artifacts):

```
Cascade complete: 27/27 artifacts processed
Tokens: 300,468 in → 14,886 out
```

Running `planr revise EPIC-004 --cascade --dry-run` spent ~300k input tokens. Running the same command again **without** `--dry-run` (to actually write the changes the user just approved) spends another ~300k. The diffs were already computed and persisted in `.planr/reports/revise-EPIC-004-2026-04-22.md` — users reasonably expect the apply step to be near-free ("just write what you already decided").

### Root cause (current implementation)

1. **Apply is a second full run.** Each artifact in the cascade triggers a new model call; there is no code path that replays a prior audit to disk. See [src/cli/commands/revise.ts:72](../../src/cli/commands/revise.ts) — `dryRun` is a boolean flag that only changes whether the write-phase runs; the AI-call loop in [src/services/revise-service.ts](../../src/services/revise-service.ts) executes regardless.
2. **The cache does not cover the dry-run → apply case.** In [src/services/revise-cache-service.ts:77-89](../../src/services/revise-cache-service.ts), `shouldSkipArtifact` only skips when `lastOutcome === 'skipped-by-agent'`. Dry-run records outcomes like `would-apply` (see line 28: `'skipped-by-agent' | 'applied' | 'would-apply' | 'flagged'`), so the next apply run still calls the AI for every would-apply artifact.
3. **The audit report is structured enough to replay.** `.planr/reports/revise-<scope>-<date>.md` already contains the rationale, evidence, and a fenced `diff` block per entry (see `.planr/reports/revise-EPIC-004-2026-04-22.md`). Everything needed to apply is on disk — the data is just not wired back in.

### Why this matters

- **Cost.** Large cascades (epic + features + stories + tasks) can be 500k+ tokens each way. Charging users twice for a review-before-write workflow discourages the workflow we want them to use.
- **Latency.** A ~3-minute dry-run becomes ~6 minutes end-to-end when the user has already approved the diffs.
- **Determinism.** The second run may produce *different* diffs than the dry-run report (model nondeterminism, context shifts from sibling artifacts changing), so the "preview" the user approved is not necessarily what gets applied.

### Acceptance criteria

1. **New flag `--apply-from <report-path>`** (or equivalent verb like `planr revise apply <report>`): reads the saved audit report, validates the diffs still apply cleanly against current artifact content, and writes them atomically — **with zero model calls**.
2. **Integrity guardrails** — before applying each diff:
   - Re-hash the artifact and compare against the hash recorded at dry-run time.
   - On mismatch, **skip that entry** and surface it in a summary ("3 of 27 entries skipped — artifact changed since dry-run; re-run revise on these").
   - Never silently write a stale diff.
3. **Safety gates still run** — atomic writes, backup to `.planr/reports/revise-<scope>-<date>/backup/`, and the existing audit log continue to work in apply-from-report mode.
4. **Report format addition** — the audit report must persist the artifact content hash (or equivalent) per entry so step 2 can work. This may require a small extension to the report serializer.
5. **Telemetry / UX** — the final summary should clearly state "Applied N entries from report, 0 tokens spent" so users see the savings.
6. **Docs** — `docs/CLI.md` and `planr revise --help` document the two-phase workflow: `--dry-run` to review, then `--apply-from <report>` to write.

### Alternatives considered

- **Option B: persist diffs in the cache** and treat `would-apply` as a cache hit on the next run. Simpler to implement, but couples apply-behavior to the cache file (which is project-local and intended as a perf optimization, not a durable decision log). The audit report is the intended source of truth.
- **Option C: merge dry-run and apply into one interactive flow** (show diff, prompt y/n, write immediately). Already partially supported via `--yes`, but doesn't serve the "review diffs offline / in PR" workflow the audit report was built for.

Option A (apply-from-report) is preferred because it leverages the existing report artifact and makes the "review then apply" workflow first-class.

### Out of scope

- Changing how revise decisions are made (prompt/model changes).
- Cross-project cache sharing.

### References

- Code: [src/cli/commands/revise.ts:72-270](../../src/cli/commands/revise.ts)
- Cache: [src/services/revise-cache-service.ts:28,77-89](../../src/services/revise-cache-service.ts)
- Example report: `.planr/reports/revise-EPIC-004-2026-04-22.md`
- User report: EPIC-004 cascade run consumed 300,468 in / 14,886 out tokens on dry-run alone

---

_Promote to agile hierarchy: `planr backlog promote BL-005 --story` or `planr backlog promote BL-005 --quick`_
_Close when done: `planr backlog close BL-005`_
