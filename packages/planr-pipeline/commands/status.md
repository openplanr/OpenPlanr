---
description: Pipeline status for a spec/feature — or, with no slug, the whole-project delivery report (every spec/backlog/quick-task + GitHub/Linear cross-ref)
argument-hint: "[slug]"
---

# /planr-pipeline:status [slug]

Read-only. Never mutates disk. Fatals use **`procedures/fatal-error-format.md`**.

Two modes:

- **No slug → whole-project delivery report** (Step A): every Spec / Backlog item / Quick Task
  rolled up by status, cross-referenced with GitHub PRs + Linear from frontmatter, with a Summary
  and an **Outstanding work** section.
- **Slug → pipeline rollup** for that spec/feature (Steps 0–3: marker, story/task counts, failures).

## Step A — No slug: whole-project delivery report (v0.18.x parity)

The planr **CLI is the deterministic engine** for this report (`planr status`,
`src/services/delivery-status-service.ts`); the plugin **delegates** to it so the two surfaces can
never drift. Only when the CLI is absent do you compose the same report natively.

**A.1 — Delegate when the CLI is installed AND new enough (preferred).**

```bash
command -v planr && planr --version
```

The delivery report shipped in CLI **1.7.2** — an older `planr` would print the legacy tree
instead. Delegate **only when the version is ≥ 1.7.2** (compare with
`printf '%s\n1.7.2\n' "$(planr --version)" | sort -V | head -1` → must print `1.7.2`). If so, run
**`planr status --md`** (add `--github` / `--linear` only if the user explicitly asked for live
cross-referencing) and print its output **verbatim**. Done — do not re-derive or "improve" the
numbers; one engine, one truth.

**A.2 — Fallback (no CLI, or CLI < 1.7.2): compose the same report from disk.** Read-only,
deterministic — never invent a status. When falling back because the CLI is outdated, append one
line: `Tip: npm i -g openplanr@latest enables the native engine (planr status --md).`

1. **Enumerate** (mode per `procedures/mode-detection.md`):
   - Specs: `.planr/specs/SPEC-*/SPEC-*.md` frontmatter → `id`, `title`, `status`
     (default mode: `output/feats/feat-*/` with their `.pipeline-shipped` markers).
   - Backlog: `.planr/backlog/*.md` → `id`, `title`, `status`, `priority`.
   - Quick tasks: `.planr/quick/*.md` → `id`, `title`, `status` + checkbox counts (`- [x]` / `- [ ]`).
2. **Classify** every item: **done** (`done|closed|completed|shipped|released`) ·
   **addressed** (`promoted|superseded` — resolved without being done; NOT outstanding, and never
   counted as done) · **outstanding** (everything else).
3. **Cross-reference from frontmatter:** `linearIssueIdentifier` (+ `linearStatusReconciled` as its
   state), `githubIssue`. If `gh` is authenticated you MAY best-effort correlate PRs by searching the
   artifact id in PR titles (`gh pr list --search "<ID>" --state all --json number,title,mergedAt`);
   label it best-effort, never as authoritative.
4. **Render** exactly this shape (the same as `planr status --md`):
   - `# <project> — Delivery Status` + a source-of-truth note
   - `## Summary` — per category: `**<Label>:** N done [+ M promoted/superseded] — T total`,
     then `**Outstanding:** none | N`
   - One `## <Category>` table per non-empty category: `| ID | Status | Title | Progress | PR | Linear |`
   - `## Outstanding work` — list each open item (`**ID** title — _status_`), or
     `None — every item is done or addressed (promoted/superseded).`

Then STOP (no Steps 0–3 in no-slug mode).

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
