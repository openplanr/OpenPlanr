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
- `SYSTEM_ONLY` = `--system` present. When set, this run only **(re)generates the project design
  system** and STOPs — it does not design a feature: bind `MODE`/`DS_DIR` (A.2), run
  `${CLAUDE_PLUGIN_ROOT}/procedures/design-system-generate.md`, log, and exit (no Phase B/C/D).

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

## A.3.5 — Resolve the app design context (APP_CTX — read the project ONCE, up front)

> **Why this is here and not in Step C (v0.15.1).** Earlier versions read the app shell /
> tokens / viewport *inside* the generate step (C.0), bundled with escaping + manifest
> mechanics — so it was done shallowly, **after** the format was already chosen in Step B, and
> no concrete **desktop width** was ever extracted (canvas artboards came out 1320×860, not a
> real 1440 desktop). Resolve it **here**, once, as bound values, so Step B *and* Step C
> consume the same grounded context instead of re-deriving it late.

Read the **project the design belongs to** and bind `APP_CTX`. This is the design system +
sizing context generation needs — gather it now, concretely:

- **`APP_SHELL`** — find + **read** the app's layout / chrome: `app/layout.*`, `src/App.*`,
  `components/{Layout,Shell,Sidebar,Nav,Header,Topbar,AppBar}.*` (framework-appropriate). Bind
  the shell file path(s) + a one-line note of its structure (e.g. "fixed 248px sidebar + 56px
  top bar + content"). If none exists (greenfield / standalone / marketing page) bind
  `APP_SHELL = none` and say so — a free-floating card is then legitimate.
- **`DESIGN_SYSTEM`** — resolve the project's design **system** with `resolveDesignSystem({ dir:
  DS_DIR })` (`$PLUG/lib/design/designSystem.mjs`; `DS_DIR` from `mode-detection.md` —
  `.planr/design-system/` spec-driven, `input/design-system/` default). It reads the package, else
  falls back to a root `DESIGN.md` / CSS-Tailwind theme / the stack's ComponentLibrary. Bind the
  real **brand color, font family, type scale, spacing, radii** from it. **If `found: false`, do
  NOT bind generic defaults** — trigger the **A.3.6 gate** below.
- **`COMPONENT_LIB`** — `ComponentLibrary` / `FrontendFramework` from `input/tech/stack.md`
  (or detect from `package.json`). Match its real component shapes; don't invent a generic kit.
- **`REF_SCREENS`** — read **1–2 real pages/components** to mirror layout density + patterns.
- **`VIEWPORT_W` + breakpoints — the single most important sizing value.** Bind the app's
  **real desktop content width**: read it from the theme (`max-width` / container max-width /
  a `--max-width` token / Tailwind `screens`+`container`). **Default `VIEWPORT_W = 1440`** for a
  desktop web app when there's no signal; a mobile-first app → its primary breakpoint (e.g.
  `390`). Also note the responsive breakpoints if the app is responsive (375 / 768 / 1024 /
  1440). **Every generated screen — including each canvas artboard — is authored at
  `VIEWPORT_W`, never a smaller ad-hoc width.**

`APP_CTX = { APP_SHELL, DESIGN_SYSTEM, COMPONENT_LIB, REF_SCREENS, VIEWPORT_W, breakpoints }`.
Step C (C.0) **consumes** this — it does not re-read from scratch. Keep the reads lightweight
(this is preflight), but bind every field to a concrete value, especially `VIEWPORT_W`.

## A.3.6 — Design-system gate: no system → ask, never go generic (v0.18.0)

A generated design must **continue** an existing feel, not invent a standalone one (a standalone
look "will be useless"). If `DESIGN_SYSTEM.found` is **false** (no `.planr/design-system/` package,
no `DESIGN.md`, no theme), this is a **user decision** — issue a **mandatory `AskUserQuestion`**
(same enforcement as Step B: a real tool_use, never narrated as prose, never auto-decided; **STOP**
with `BLOCKED — AskUserQuestion unavailable` if no variant is callable):

> **<slug>** has no design system yet — a design needs one to continue. How should I get it?
> A) **Generate one** — create a project design system (tokens + brand + components), then design this feature in it *(recommended for a greenfield project)*
> B) **Use an existing one** — point me at a path (a `DESIGN.md`, a CSS/Tailwind theme, an app dir, or a design-system package)
> C) **Describe the brand** — answer a few questions (product, feel, brand color, light/dark) and I'll derive a starter system
> D) **Cancel**

- **A** → run `${CLAUDE_PLUGIN_ROOT}/procedures/design-system-generate.md` (existing-app scan first;
  Advisor mode if vague). It writes the package to `DS_DIR` and rebinds `DESIGN_SYSTEM`.
- **B** → read the given path and **normalize it into the `DS_DIR` package** (tokens.css + manifest +
  brand + components), then rebind. (Ingesting — not just pointing — is what guarantees continuity
  on every future run.)
- **C** → gather the ≤4 brand answers, then run `design-system-generate.md` with them.
- **D** → STOP cleanly (the `.lock` is acquired in A.4, so nothing to release).

**Continuity is the whole point:** every path **persists** the system to `DS_DIR`, so this feature
*and every future `/design` + the PO designer-agent* build on the same look — never standalone.
Under **`--yes`**: choose **A** if any app signal exists (continue what's there), else **C** with
sensible defaults — **never** silently proceed generic.

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
  app context:     viewport <VIEWPORT_W>px · shell <APP_SHELL or none> · lib <COMPONENT_LIB>
  design system:   <summarizeDesignSystem(DESIGN_SYSTEM)>   (if "none" → a real run fires the A.3.6 gate)
  recommended:     <format> — <reason>
  would write:     finalized.html|canvas.html, finalized.json, vendor/, design-spec.md
```

Release the lock and **STOP**. No generation, no other writes.
