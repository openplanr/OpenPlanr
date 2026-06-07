# Procedure: /design Step A — preflight (mode, context, lock)

> Read by `commands/design.md` Step A. Resolves everything generation needs and guards
> against concurrent runs. Writes nothing except the advisory lock.

## A.1 — Parse arguments

From `$ARGUMENTS`:
- `SLUG` = first non-flag token (strip a leading `feat-` / `spec-`).
- `FORMAT` = value of `--format` (one of `prototype|walkthrough|canvas`) or empty.
- `FROM` = value of `--from` (one of `spec|png|describe`) or empty.
- `YES` = `--yes` present.
- `DRY_RUN` = `--dry-run` present.

If `--format` is given with an unknown value, abort (`fatal-error-format.md`):
```
⚠ Unknown --format "<value>" (expected prototype | walkthrough | canvas)
Repair: /planr-pipeline:design <slug> --format walkthrough
```

## A.2 — Bind mode + design dir

Run `${CLAUDE_PLUGIN_ROOT}/procedures/mode-detection.md` to bind `MODE`, `SPEC_DIR`
(spec-driven) / `FEAT_DIR` (default). Then bind the design directory:

- spec-driven, spec resolves: `DESIGN_DIR = <SPEC_DIR>/design/`
- default mode: `DESIGN_DIR = output/feats/feat-${SLUG}/design/`

### No spec for `<slug>` (spec-driven) — ask; never silently scaffold or abort

If spec-driven mode is active but `mode-detection` resolves **no spec** for `SLUG`, this is a
user decision, not a default. **Do NOT silently invent / scaffold a `SPEC-NNN` spec** (the
prior-version bug — it polluted `.planr/specs/` with an unrequested spec), and do NOT silently
abort. Issue a **mandatory `AskUserQuestion` tool call** — same enforcement as Step B: it MUST
be sent as a tool_use, never narrated as prose, and you must never auto-pick:

> No spec exists for **<slug>** yet. How do you want to design it?
> A) **Create a spec** — scaffold `SPEC-NNN-<slug>` as the home, then design into it (the planned-feature path; `/plan` can consume it later)
> B) **Standalone exploration** — design only, into `.planr/designs/<slug>/`; no tracked spec is created
> C) **Cancel**

- **A** → scaffold a minimal spec via `${CLAUDE_PLUGIN_ROOT}/procedures/auto-scaffold-spec.md`
  (or the `templates/spec-driven.md.tpl` shell), bind `SPEC_DIR` to it, and
  `DESIGN_DIR = <SPEC_DIR>/design/`. Scaffolding is allowed **only here**, because the user
  explicitly chose it.
- **B** → `DESIGN_DIR = .planr/designs/<slug>/` (standalone). **No `SPEC-NNN` file is written.**
  `design-spec.md` lands here too, but it is NOT auto-consumed by `/plan` until the user
  promotes it to a spec (option A on a later run, or `/planr-pipeline:plan <slug>`).
- **C** → STOP cleanly (the `.lock` is not acquired until A.4, so nothing to release).

Under **`--yes`** with no spec, assume **B (standalone exploration)** — the least-surprising,
non-polluting default — and say so. **Never** assume **A** under `--yes`: silently creating a
tracked spec is exactly the bug being fixed.

Create `DESIGN_DIR` if missing.

## A.3 — Resolve the screen list + context

- **Screen list:** read the spec body and apply the `lib/design/screens.mjs` rules
  (frontmatter `ui_files:` list, then the first body section whose heading mentions
  "screen"). Bind `SCREENS` (array) and `SCREEN_COUNT`.
- **PNGs present?** Check the mode's PNG locations (`mode-detection.md` "PNG presence" row).
  Bind `HAS_PNG`. This drives the one-writer precedence in Step D.
- **Prior design?** If `DESIGN_DIR` already holds a `finalized.json`, bind `HAS_PRIOR` and
  read its `design_format` + `iterations` (drives the evolve/replace branch in Step B).
- **Tokens:** if `DESIGN.md` exists at the repo root, note it as the design-token source.
- **Existing design docs?** `ls <DESIGN_DIR>/*.md` excluding `design-spec.md` (e.g. a
  hand-written `ux-flows.md`). Bind `DESIGN_DOCS` (paths). These become a screen source the
  user can pick in the thin-spec clarification below.

**Thin-spec handling (v0.13.1 — interactive asks, never dead-ends):** compute the action
with `lib/design/interactivity.mjs` `decideThinSpec({ screenCount: SCREEN_COUNT, from: FROM,
format: FORMAT })`:

- **`proceed`** — screens resolved, or `--from describe` (which derives screens from the
  brief). Continue.
- **`abort`** — `SCREEN_COUNT == 0` **and headless** (both `--format` and `--from` supplied,
  source not `describe`): there is no way to prompt, so two-line fatal
  (`fatal-error-format.md`):
  ```
  ⚠ <slug> resolves 0 screens (no Screens section / ui_files) and the run is headless (--format + --from set)
  Repair: /planr-pipeline:design <slug> --from describe --format <format>
  ```
- **`clarify`** — `SCREEN_COUNT == 0`, **interactive**: do **NOT** abort. Bind `THIN_SPEC =
  true` and continue — Phase B (§ B.0.5) asks the user how to source the screens
  (derive-from-brief / use an existing `DESIGN_DOC` / add a `## Screens` section / cancel).
  Never invent a screen list here (SPEC-015 F8: thin spec → clarify, don't fabricate).

## A.4 — Acquire the advisory lock (SPEC-015 E1)

Lock file: `DESIGN_DIR/.design.lock` (JSON: `{ pid, host, started_at, command, ttl_seconds: 1800 }`).

- If the lock exists, is younger than its TTL, **and** its `pid` is still alive → refuse:
  ```
  ⚠ Another /design run holds <DESIGN_DIR>/.design.lock (pid <pid>, started <started_at>)
  Repair: wait for it to finish, or remove the stale lock and re-run
  ```
- Otherwise (absent, expired, or dead pid) → write a fresh lock and proceed.

The lock is released in Step D (and on any fatal abort). It is git-ignored — see the
`.gitignore` entry `**/.design.lock`.

## A.5 — Dry-run exit

If `DRY_RUN`: compute the recommended format via `lib/design/recommendFormat.mjs`
(`{ screenCount: SCREEN_COUNT, intentText: <spec title/summary> }`), then print:

```
/design dry-run — <slug>
  mode:            <MODE>
  design dir:      <DESIGN_DIR>
  screens:         <SCREEN_COUNT> (<comma-joined SCREENS, truncated>)
  has PNGs:        <HAS_PNG>     prior design: <HAS_PRIOR>
  thin-spec:       <decideThinSpec action: proceed | clarify | abort> (design docs: <DESIGN_DOCS or none>)
  recommended:     <format> — <reason>
  would write:     finalized.html|canvas.html, finalized.json, vendor/, design-spec.md
```

Release the lock and **STOP**. No generation, no other writes.
