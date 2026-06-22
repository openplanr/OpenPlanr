---
description: Reconcile spec ↔ quick-task ↔ issue-tracker alignment across .planr/ — guarantee every shippable spec carries its externalization Quick Task (the unit pushed to Linear/GitHub for PO + manager visibility), fix deterministic drift, surface judgment calls. Read-only by default.
argument-hint: "[--apply] [--push] [--branch <name>] [--tracker linear|github|auto]"
---

# /planr-pipeline:sync [--apply] [--push] [--branch <name>] [--tracker linear|github|auto]

Read-only by default — never mutates disk or the network unless `--apply` / `--push` (or an
explicit confirmation) is given. Fatals use **`${CLAUDE_PLUGIN_ROOT}/procedures/fatal-error-format.md`**.

## Why this exists

In planr the **Quick Task (QT) is the externalization handle.** Specs, stories, and internal
tasks live in `.planr/`; the **QT is the one artifact pushed to the issue tracker** (Linear
and/or GitHub), so a spec's progress is visible to POs and managers *outside* `.planr/`. A
shipped spec with no QT — or a QT that never reached the tracker — is invisible to everyone who
doesn't read the repo. `sync` enforces the contract: **every non-meta spec maps 1:1 to a QT**,
that QT's status mirrors the spec's *evidenced* state, and it is pushed to the configured tracker.

## The three links it reconciles
1. **spec ↔ QT** — every non-meta spec has exactly one linked QT (created if missing).
2. **QT status ↔ spec evidenced status** — the QT reflects reality, not the stale `status:` field.
3. **QT ↔ tracker issue** — the QT carries its `linearIssueIdentifier` / `githubIssue`, and the
   remote issue exists and matches.

## Flags
| Flag | Effect | Default |
|------|--------|---------|
| (none) | Audit + classified report only. No writes, no network. | on |
| `--apply` | Apply the **SAFE-class** fixes locally (status flips, missing wrapper QTs). | off |
| `--push` | After `--apply`, push changed QTs to the tracker, then `git commit` (+ push). | off |
| `--branch <name>` | Branch to operate on. | auto-detect |
| `--tracker <t>` | Force `linear` / `github`; `auto` uses whatever the project configures. | auto |

## HARD RULES (violating any ⇒ abort via `fatal-error-format.md`)
1. **Operate on the canonical branch.** The richest `.planr/` state may live on a long-lived
   integration branch, not the default branch. Resolve it: honour `--branch`; else auto-detect the
   branch whose `.planr/specs` tree holds the most specs / the newest ship markers. `git fetch`
   then `git merge --ff-only` that branch's remote tip **before** auditing — a stale or diverged
   tip yields a wrong answer (abort on a non-ff divergence and say so). If the working tree has
   uncommitted tracked changes, abort and tell the user.
2. **"Done" is evidenced, never assumed.** A spec is done iff ALL its internal tasks are `done`
   AND its ship marker shows **`qa_gate_status: passed`** — spec-driven `<SPEC_DIR>/.pipeline-shipped`,
   default mode `output/feats/feat-*/.pipeline-shipped`. The spec's own `status:` field is
   unreliable — use it only to *detect* drift, never as the source of truth.
3. **Resolve the spec↔QT link three ways:** QT frontmatter `sourceSpec: SPEC-NNN`; the spec-dir
   slug convention (`SPEC-NNN-qt-MMM` ⇒ QT-MMM); spec frontmatter `sourceQuickTask`.
4. **Never auto-touch a QT whose scope is broader than its spec.** If a QT links to a backlog item
   (`sourceBacklog`), maps to more than one spec, or its title/body clearly covers work beyond the
   single spec, it is OUT of the safe class — list it for the human, change nothing.
5. **Never create a QT for a meta/ledger spec.** A spec whose frontmatter marks it non-product
   (e.g. `note`/`kind` says ledger / "not a product spec" / "excluded from the build DAG") is
   auto-excluded from QT creation.
6. **Outward-action gate.** Any tracker push and any `git push` require `--push` OR an explicit
   user confirmation, and are always preceded by a dry-run preview. Every operation is
   **idempotent** — re-running on an aligned repo prints "up to date" and changes nothing.
7. **The local reconciliation is NATIVE; only the push delegates.** Spec status, QT status, and QT
   creation are plain `.planr/` file edits (frontmatter + a new `quick/QT-*.md`) — no CLI needed,
   so the audit + SAFE local fixes always work. Spec status changes by editing the spec's
   frontmatter `status:` (+ bump `updated:`); the `planr` CLI does **not** status-update SPEC ids.
   The tracker push is the one networked step — see Step 6 for runtime surface discovery.

## Steps
1. **Branch** — resolve + fast-forward per Rule 1.
2. **Detect tracker(s)** — infer from `.planr/config.json`, the encrypted credential store, and
   existing `linearIssueIdentifier` vs `githubIssue` frontmatter (or `--tracker`). Bind the target
   tracker(s). If none is configured, still run the audit + report, but skip the push class and say so.
3. **Audit (read-only).** Run `${CLAUDE_PLUGIN_ROOT}/procedures/mode-detection.md`. For every `.planr/specs/SPEC-*`
   (spec-driven) / feature dir (default): read `status`, count `done/total` tasks (exclude
   `*-error-report.md`), read the ship marker, resolve the linked QT(s) (Rule 3) + their `status`
   and tracker id (`linearIssueIdentifier` / `githubIssue`). Build one table.
4. **Classify each spec / QT pair:**
   - ✅ **aligned** — evidenced-done spec + done QT + tracker id present → skip.
   - 🟢 **safe-fix** (deterministic, 1:1, reversible):
     - spec has **no linked QT** and is not a meta spec → create a wrapper QT mirroring the spec's
       current evidenced status (next free `QT-NNN`, `sourceSpec`, project/labels copied from a
       sibling QT, no tracker id — the first push mints it). *This is the core "everything has its
       QT" guarantee — it applies to in-progress specs too, so manager visibility starts on day one.*
     - spec is evidenced-done (Rule 2) but `status` is stale → set spec `status: done` (+ `updated:`).
     - spec evidenced-done and its **1:1** QT is still pending → mark the QT done.
     - QT done locally but its tracker issue is missing / out of sync → push it (Step 6).
   - 🟡 **needs-judgment** (LIST ONLY, never auto-apply): QT broader than its spec (Rule 4); a done
     spec whose QT is a go-live/ops task still in progress; any pair with mixed/contradictory evidence.
   - ⚙️ **meta** — auto-excluded per Rule 5.
5. **Apply** — only with `--apply`, only the 🟢 class, after printing the dry-run diff. All edits
   are native file writes to `.planr/` (frontmatter + new `quick/QT-*.md`).
6. **Push** — only with `--push` (or confirmation). **Discover the push surface at runtime** (don't
   assume a verb): run `command -v planr && planr --help` and look for the QT/tracker push
   subcommand; use it for the configured tracker (Linear via the planr Linear integration — the PAT
   is read from the encrypted credential store; GitHub via the planr GitHub path, else `gh issue`).
   Push only `QT/EPIC/FEAT/US/TASK` ids — **never** a SPEC (the SPEC has no tracker issue; its QT
   does). If no push surface is available, print each changed QT + the exact command to run and
   **stop short of pushing** (never fail the run). After a successful push: `git add` ONLY the
   touched `.planr/` files (never `-A`), commit (no AI-assistant metadata), and push to the
   canonical branch.
7. **Report** — counts (specs/QTs total + done + newly-aligned), the 🟢 changes made, the 🟡 list
   with a one-line rationale each, any newly-minted tracker ids, and a `next:` hint (re-run with
   `--apply` / `--push`, or the specific command for an undiscovered push surface). STOP.

## Termination
Done when the report prints. Never push without `--push`/confirmation. Never assert "done" without
ship-marker evidence. Leave 🟡 items for the human — do not guess.
