# Compatibility Matrix — OpenPlanr Protocol v1.0.0

> Per-capability parity across the three first-class runtime adapters. Updated for planr-pipeline v0.6.0.

## TL;DR

OpenPlanr ships three runtime adapters that all implement the same artifact contract:

| Runtime | Install | Adapter |
|---|---|---|
| **Claude Code** *(canonical)* | `/plugin install planr-pipeline@openplanr` | This plugin (manifest-enforced subagents) |
| **Cursor** | `npm i -g openplanr && planr rules generate --target cursor --scope pipeline` | `.cursor/rules/planr-pipeline.mdc` + agent body files |
| **Codex** | `npm i -g openplanr && planr rules generate --target codex --scope pipeline` | `AGENTS.md` with pipeline section |

Same `.planr/specs/` directories. Same SPEC / US / Task schema. Same `.pipeline-shipped` marker. The pipeline shells the contract; runtimes are interchangeable adapters.

## Capability matrix

| Capability | Claude Code (A) | Cursor (A2) | Codex (A3) |
|---|---|---|---|
| **PLAN orchestration** | ✅ slash command (`/planr-pipeline:plan`) | ✅ rule auto-attach on glob match | ✅ persona-triggered ("plan {feature}") |
| **SHIP orchestration** | ✅ slash command (`/planr-pipeline:ship`) | ✅ rule | ✅ persona |
| **8 named subagents** | ✅ manifest-declared, model pinned | ⚠️ Composer subagent dispatch (Cursor 1.x) | ⚠️ persona role-shift only (no isolation) |
| **Tool restrictions** (`Bash(psql:*)` etc.) | ✅ enforced at manifest layer | ❌ prompt-level only — model honours voluntarily | ❌ prompt-level only |
| **Spec-driven mode** (`.planr/specs/`) | ✅ | ✅ | ✅ |
| **Default mode** (`output/feats/`) | ✅ | ✅ | ✅ |
| **Auto-scaffold spec shell** | ✅ | ✅ | ✅ |
| **Self-heal `input/tech/stack.md`** | ✅ | ✅ | ✅ |
| **3-iteration correction loop** (R6) | ✅ | ✅ (prompt-driven) | ✅ (prompt-driven) |
| **`.pipeline-shipped` marker** | ✅ writes runtime: claude-code | ✅ writes runtime: cursor | ✅ writes runtime: codex |
| **CLAUDE.md snapshot** (R7) | ✅ via Stop hook + Step 5 | ⚠️ no Stop hook — `.cursor/.snapshot-pending` sentinel only | ⚠️ no Stop hook |
| **Coexistence with planr-managed CLAUDE.md** | ✅ explicit detect + skip | ✅ explicit detect + skip | ✅ explicit detect + skip |
| **R1 PLAN/SHIP separation** | ✅ two distinct commands | ✅ two distinct rules | ✅ two distinct keywords |
| **R3 model assignments fixed** | ✅ at manifest | ⚠️ best-effort (Cursor model picker) | ⚠️ best-effort (Codex model picker) |
| **`${CLAUDE_PLUGIN_ROOT}` resolution** | ✅ native | ❌ substituted with `.cursor/rules/` paths | ❌ substituted with project paths |
| **3-min onboarding for new users** | install plugin + `/plan` | `npm i -g openplanr` + `rules generate` + say "plan" | `npm i -g openplanr` + `rules generate` + say "plan" |
| **Conformance test passes** | ✅ | ✅ (with caveats below) | ✅ (with caveats below) |

## Caveats

### Tool restrictions on Cursor and Codex are advisory

The Claude Code plugin enforces tool restrictions at the manifest layer (e.g., `db-agent` literally cannot invoke `git` because `Bash(git:*)` is not in its allowed tools list). Cursor and Codex have repo-level permission models that don't map cleanly to per-persona restrictions.

**Mitigation:** the conformance test runner (`conformance/runner.mjs`) does a post-ship `git diff` check on every task's `Preserve:` list. A model that violates a Preserve rule on Cursor or Codex will be caught after the fact, even though the violation wasn't blocked at runtime.

**Implication:** for high-trust environments (production codegen on enterprise repos), Claude Code is the recommended runtime. Cursor and Codex are excellent for development workflows but should not be relied on for security-critical pipelines.

### No Stop hook on Cursor or Codex

Claude Code fires a `Stop` hook when a command terminates. The pipeline uses this to remind users to run a snapshot if `/ship` aborted mid-flow.

**Cursor adapter:** writes `.cursor/.snapshot-pending` at start of `/ship` Step 0; surfaces a reminder on next session start. Best-effort, not guaranteed.

**Codex adapter:** no equivalent at all. The `.pipeline-shipped` marker still gets written on successful runs, so the audit trail is intact.

**Implication:** if your `/ship` aborts before snapshot on Cursor or Codex, the next session may not surface a reminder. Run `git status .cursor/.snapshot-pending` (Cursor) or check for an absent `.pipeline-shipped` (Codex) to detect.

### Cursor subagent dispatch is empirically verified, not contractually documented

Cursor 1.x's Composer dispatches subagents from rule files containing system prompts. This is a real capability — verified live during pre-launch testing — but Cursor's public documentation doesn't pin the subagent model formally.

**Mitigation:** the Cursor adapter pins to Cursor 1.x. If the runtime changes the dispatch model in 2.x+, the adapter may need an update. The conformance test will catch the regression.

**Implication:** treat Cursor compatibility as a soft contract that evolves with Cursor. The protocol is stable; the adapter ships with a "best supported as of planr-pipeline v0.6.0" warranty.

### Codex 2.0 persona quality not yet measured

The Codex adapter ships v1 with the AGENTS.md format. Persona role-shift is the mechanism — the model adopts the role's behaviour during a specific task — but cross-persona context contamination is theoretically possible.

**Mitigation:** for v1, document this as a known polish item. Run the conformance fixture against Codex pre-launch and document the result. If quality is significantly below Cursor parity, flag it explicitly in the matrix.

**Implication:** Codex compatibility is "preview" until live measurement closes. Users wanting maximum quality should prefer Claude Code or Cursor.

## Cross-runtime spec portability

A SPEC authored on one runtime is consumable by any other:

```bash
# On a Cursor-only machine:
planr spec create "User auth" --slug auth --priority P0
# scaffolds .planr/specs/SPEC-001-auth/ with v1.0.0 schema

# Move the project to a teammate using Claude Code:
git pull
/planr-pipeline:plan auth
# the Claude Code plugin reads the same SPEC-001-auth directory
```

This is the single biggest payoff of the protocol: teams can mix runtimes per developer without coordination overhead.

## When to use which adapter

| If your priority is... | Pick this runtime |
|---|---|
| Manifest-enforced security (production codegen on enterprise code) | Claude Code |
| IDE integration with strong UI/UX | Cursor |
| Already on Codex, want pipeline workflow without switching | Codex |
| Maximum cross-team flexibility | All three — same artifacts; per-developer choice |

## See also

- `protocol/README.md` — protocol overview
- `protocol/spec-artifacts.md` — artifact schema
- `protocol/agent-roles.md` — 8 role contracts
- `protocol/commands.md` — PLAN and SHIP contracts
- `protocol/runtime-adapters.md` — per-adapter specs
- `../conformance/README.md` — how to run the conformance test against any runtime

---

*OpenPlanr Protocol v1.0.0 — compatibility matrix.*
