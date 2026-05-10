---
description: Show pipeline status for a decomposed spec/feature (marker, story/task counts, failures)
argument-hint: <slug>
---

# /planr-pipeline:status {slug}

Read-only rollup for `${SLUG}` (first token — same slug hygiene as `/plan`). Never mutates disk. Fatals use **`procedures/fatal-error-format.md`**.

## Step 0 — Bind paths

1. Run **`procedures/mode-detection.md`** with `${SLUG}` from argv.
2. If spec missing / feat dir missing, mirror `/ship` absent-input messages (two-line).

Counts:

| Concept | Default mode | Spec-driven |
|---|---|---|
| Story files | `FEAT_DIR/us-*/us-*.md` | `<SPEC_DIR>/stories/US-*.md` |
| Task files | `FEAT_DIR/us-*/tasks/task-*.md` | `<SPEC_DIR>/tasks/T-*.md` **excluding** `*-error-report.md` |

## Step 1 — Marker + failure artifacts

Attempt to read:

- **Default:** `output/feats/feat-${SLUG}/.pipeline-shipped`
- **Spec-driven:** `<SPEC_DIR>/.pipeline-shipped`

YAML fields of interest: `shipped_at`, `tasks_executed`, `tasks_failed`, `qa_gate_status`.

Also glob per-task handoffs: **`T-*-error-report.md`** residing next to sibling task Markdown.

## Step 2 — Render table *(stdout)*

Emit markdown similar to:

```text
/planr-pipeline:status ${SLUG}   MODE=<default|spec-driven>

| Metric | Value |
|--------|-------|
| User stories | <US_COUNT> |
| Tasks (planned) | <TASK_TOTAL> |
| Last ship | <ISO ts | "(never)" when marker absent> |
| Tasks executed (last ship) | <marker.tasks_executed | 0> |
| Tasks failed (last ship) | <marker.tasks_failed | 0> |
| Open T-* failure handoffs | <count of error-report blobs> |

Notes:
- `--dry-run`: not applicable here.
```

**Pre-ship / no marker:** show **`Last ship`** = `(never)`, executed/failed **`0 / 0`**, still print story + planned task totals (SPEC-006 “zeros OK”). **Never** silently invent progress.

## Step 3 — Manifest timing *(SPEC-008 — optional additive)*

| Concept | Path |
|---|---|
| Manifest (spec-driven) | `<SPEC_DIR>/.run-manifest.jsonl` |
| Manifest (default) | `output/feats/feat-${SLUG}/.run-manifest.jsonl` |

1. **If missing or whitespace-only:** stop with no appendix (baseline status table already emitted).
2. **If readable:** iterate lines → trim → skip empties → `JSON.parse` each. First parse error → **`⚠ Manifest: JSON parse failure on line <n>`**, then omit appendix.

**Latest-run segmentation:** Partition objects by occurrences of **`stage === "ship.bootstrap"`**. The **final segment starts at** the terminal `ship.bootstrap` line and covers every later record through EOF (**use whole file instead when no bootstrap rows exist**, legacy runs).

Inside that segment compute per-row Δ seconds (**`started_at`** → **`ended_at`**) skipping invalid ISO rows. **`Wall span`** = max(`ended_at`) − min(`started_at`) across usable rows inside the segment.

After the SPEC-006 table paste:

```
### Manifest (last-run preview)
| Stage | Agent | Seconds (Δ) | exit_status |
|---|---|---|---|
| … | … | … | … |

Wall span (manifest): ~<sec>s
```

If **`cost_hint`** strings exist, bullet them under **`Cost hints (informational)`**; otherwise omit subsection.

Remain read-only; never mutate `.run-manifest.jsonl` from `/status`.

Stop after appendix (or warnings).
