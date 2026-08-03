# OpenPlanr Protocol — Runtime Adapters (v1.1 capabilities)

> How each AI coding agent runtime implements the protocol. Three adapters today; the protocol is open for additional runtime integrations.

## Adapter contract

A runtime adapter implements the protocol if and only if:

1. It exposes PLAN and SHIP as user-invokable commands.
2. PLAN and SHIP execute the orchestration described in `commands.md`.
3. PLAN does NOT auto-chain to SHIP (rule R1).
4. The 9 roles in `registry/roles.json` are dispatched through native subagents
   when available or the declared sequential fallback.
5. The artifacts produced — SPEC, US, Task, design-spec, qa-report, error-report, `.pipeline-shipped` — match `spec-artifacts.md` byte-for-byte (modulo timestamp).
6. The `.pipeline-shipped` marker `runtime` field correctly identifies the runtime.

The conformance test fixture (`planr-pipeline/conformance/`) verifies items 5 and 6 mechanically. Items 1-4 require human inspection of the runtime's behaviour against the fixture.

## Claude Code adapter (canonical)

**Repo:** `openplanr/planr-pipeline`
**Install:** `planr setup --runtime claude`
**Adapter version:** independently versioned and locked through the compatibility manifest

### Implementation

- **Slash commands:** `commands/plan.md` and `commands/ship.md` registered via Claude Code plugin manifest
- **Subagents:** `agents/{role}.md` files with YAML frontmatter declaring `name`, `description`, `tools`, `model`. Tool restrictions enforced at the manifest layer — agent literally cannot invoke disallowed tools.
- **Hooks:** `hooks/hooks.json` registers a Stop hook for the `.snapshot-pending` reminder.
- **Templates:** `templates/{spec,spec-driven,stack,error-report,CLAUDE.md}.tpl` referenced via `${CLAUDE_PLUGIN_ROOT}` from commands and agents.

### Strengths

- Full manifest-enforced tool restrictions (R8, R9 enforced at the runtime layer, not just prompt)
- Stop hook provides safety net for snapshot reminder
- First-class slash command surface; no naming collision with built-ins (after v0.5.0 cleanup)

### Caveats

- Some users may not have Claude Code; this adapter doesn't help them.

### Native parallel dispatch (multi-task mode) — SPEC-014

In `DISPATCH_MODE: multi-task` (the Claude Code default — see `../compatibility-matrix.md` §Dispatch mode), the orchestrator dispatches every *ready* task as a **native parallel `Agent` call in a single assistant turn**, all operating in the shared main working tree. This is exactly the native Claude Code parallel sub-agent behavior — the plugin adds no sandbox of its own.

- **No isolation, no merge-back.** Dispatched `Agent` calls do not set `isolation`; sub-agents write directly to the repo working tree. There is no private branch, no worktree, and no file-by-file merge step.
- **Ordering is `dependsOn`-only.** planr does no write-set inference and no cycle detection. The only ordering constraint it honors is an explicit `dependsOn:` field — a dependent task is held back until its declared dependencies are `done`. Absent `dependsOn`, ready tasks dispatch together. Within a turn, ready tasks are id-sorted.
- **No concurrency knob.** The host's native concurrency cap is the only throttle (the `--max-parallel` flag was removed in SPEC-014). Cursor and Codex run `DISPATCH_MODE: per-task` — one task per invocation — and never fan out.
- **Advisory lock-list.** When two tasks touch a lock-listed path (`package.json`, lockfiles, `**/index.ts`, migrations, …) the dispatch prompt carries a non-enforcing advisory note. It changes no control flow.
- **Single-writer bookkeeping.** Task `.md` `status` fields and `.run-manifest.jsonl` are written only by the orchestrator in the main tree. The native dispatch contract is documented in `docs/feat-parallel-dispatch/` (SPEC-014 supersedes the SPEC-013 worktree + wave scheduler).

## Cursor adapter

**Installed by:** `planr setup --runtime cursor`
**Lives at:** `.cursor/rules/openplanr.mdc` + `.cursor/rules/openplanr-roles/*.md`
**Minimum runtime version:** Cursor 1.x with Composer subagent dispatch

### Implementation

- **Master rule:** a portable project rule using repository-relative paths.
- **Role files:** nine generated contracts sourced from `registry/roles.json`.
- **Execution:** the router returns a machine-readable Composer handoff; the
  adapter uses host dispatch when supported and sequential fallback otherwise.
- **Compatibility aliases:** legacy `planr-pipeline*.mdc` files remain as
  deprecation stubs for two pipeline minor releases.

### Strengths

- Native Cursor 1.x subagent dispatch (verified empirically)
- Auto-attach via `globs` — pipeline rules surface only when relevant files are open
- Same `.planr/specs/` artifacts as Claude Code; cross-runtime spec portability

### Caveats

- **Tool restrictions are advisory (prompt-level only).** Cursor's permission model is repo-level, not per-persona. The conformance test catches violations via post-ship git-diff on Preserve paths.
- **No Stop hook equivalent.** Snapshot reminder uses `.cursor/.snapshot-pending` sentinel surfaced on next session start.
- **Subagent dispatch fragility.** This is an emergent Cursor capability, not a documented primitive. Pinned to Cursor 1.x; behaviour may shift.
- Portable Cursor assets contain no Claude-only paths, commands, or model names.

## Codex adapter

**Installed by:** `planr setup --runtime codex`
**Lives at:** user-scope `$planr-*` skills plus a concise managed policy block in `AGENTS.md`

### Implementation

- **Skills:** PLAN, Design, SHIP, dashboard, sync, and doctor are durable user-scope workflows.
- **Project policy:** `AGENTS.md` contains artifact pointers and binding project rules, not the whole pipeline.
- **Dispatch:** real subagents and ready-task parallelism are used when exposed by
  the runtime; otherwise the same role registry executes sequentially.
- **Mode detection:** deterministic and owned by the package engine.

### Strengths

- Small, inspectable user-scope skill install
- Same artifact contract as other adapters
- Coexists with planr CLI's agile-mode AGENTS.md content (concatenation, not overwrite, when `--scope all`)

### Caveats

- **Tool restrictions may be advisory.** The adapter reports the runtime's actual
  isolation capability; Preserve conformance remains mandatory.
- **No Stop hook equivalent.** Snapshot reminder is a soft prompt-level reminder.
- Headless availability and subagent capability are detected rather than assumed.

## Mode isolation (introduced in v0.8.0)

### What it is

Each agent prompt is now a thin **entry loader** (≤60 lines) at `agents/<role>-agent.md`. The entry file preserves frontmatter (`name`, `description`, `tools`, `model`) verbatim and adds a `Read` directive listing the mode-specific files to load.

Per-mode prompt content lives at `agents/modes/{spec-driven,default}/<role>.md` (≤120 lines each). Truly identical content — the create/modify/preserve contract, the correction-loop protocols — lives at `agents/modes/shared/<topic>.md` and is referenced from both per-mode files.

The mode-detection block used by both orchestrator commands lives at `procedures/mode-detection.md` and is `Read` from `commands/plan.md` and `commands/ship.md`.

### Why it exists

Three motivations, in order:

1. **Per-invocation token reduction (~30%).** Only the active mode's content loads into the agent's context — the entry file plus the matched per-mode file plus any shared topics it references. The inactive mode's prompt body is not read.
2. **Clearer separation of mode-specific content.** Path mappings, ID-scoping rules, and artifact conventions that differ between modes now live in physically separate files instead of being interleaved with conditional language inside one prompt.
3. **Both modes stay first-class.** Default mode remains the lightweight solo-dev fast-feedback path (`output/feats/feat-{name}/` layout, no planr CLI required); spec-driven mode remains the formal team / PO-handoff path (`.planr/specs/SPEC-NNN-{slug}/` layout, planr CLI compatible). The refactor preserves both as primary user surfaces — see `docs/audit/2026-05-audit.md` Errata for the framing rationale.

### How adapters mirror it

- **Claude Code (canonical):** the layout described above is what the plugin ships at `agents/<role>-agent.md` + `agents/modes/{spec-driven,default,shared}/`. Future updates are drop-ins to the per-mode and shared files; the entry file rarely changes.
- **Cursor adapter:** `.cursor/rules/agents/<role>.md` should mirror the same thin-entry-loader pattern, with mode-specific content included via Cursor's `Read` equivalent. The recommended on-disk layout is `.cursor/rules/agents/modes/{shared,spec-driven,default}/<role>.md`. Frontmatter handling differs from Claude Code (Cursor uses `globs`, not manifest-enforced `tools`), but the mode-isolation file structure is portable.
- **Codex adapter:** Codex's `AGENTS.md` persona section can either (a) replicate the loader pattern with mode-specific persona blocks if Codex supports per-persona file inclusion, or (b) keep the larger combined persona block as a Codex-specific tradeoff and document the bloat clearly. The conformance fixture coverage (the default-mode fixture under `conformance/fixtures/default-mode/` plus the mode-detecting runner) catches behaviour drift either way, so the adapter is free to choose based on Codex runtime constraints.

### Conformance impact

Two fixtures live under `conformance/fixtures/{spec-driven,default-mode}/`. The runner (`conformance/runner.mjs`) auto-detects the fixture's mode from its directory layout (`.planr/specs/` present → spec-driven; `output/feats/` present → default). Adapter conformance tests must pass against **both** fixtures, not just the spec-driven one — single-mode pass is no longer sufficient.

## Compatibility quick-reference

| Capability | Claude Code | Cursor | Codex |
|---|---|---|---|
| `PLAN` / `SHIP` orchestration | ✅ slash command/router | ✅ Composer handoff | ✅ skills/router |
| Subagents (9 roles) | ✅ manifest-declared | ⚠️ host capability | ✅ when exposed; sequential fallback |
| Manifest tool restrictions | ✅ enforced | ❌ advisory only | ❌ advisory only |
| Spec-driven mode | ✅ | ✅ | ✅ |
| Auto-scaffold spec shell | ✅ | ✅ | ✅ |
| Self-heal stack.md | ✅ | ✅ | ✅ |
| 3-iteration correction loop | ✅ | ✅ (prompt-driven) | ✅ (prompt-driven) |
| `.pipeline-shipped` marker | ✅ | ✅ | ✅ |
| CLAUDE.md snapshot | ✅ via Stop hook | ⚠️ no Stop hook | ⚠️ no Stop hook |
| R1 PLAN/SHIP separation | ✅ two commands | ✅ two rules | ✅ two keywords |
| Conformance test passes | ✅ | ✅ (with caveats) | ✅ (with caveats) |

Full matrix with caveats: `../compatibility-matrix.md`.

## Adding a new runtime adapter

To add a fourth runtime (e.g., Aider, Cline, Continue):

1. Implement the contract above (PLAN, SHIP, role dispatch, R1).
2. Add an adapter entry to `registry/adapters.json` with capabilities, assets,
   health checks, and lifecycle drivers.
3. Generate runtime assets from the shared role and command registries.
4. Add detection, migration, rollback, and uninstall drivers to `planr`.
5. Run the conformance test fixture against the new adapter.
6. Submit a PR to `planr-pipeline` with the adapter spec and matrix entry.

The protocol is open. New runtimes are welcome.

---

*OpenPlanr Protocol v1.0.0 — runtime adapter specs.*
