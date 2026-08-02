# Compatibility Matrix - Protocol v1.0 artifacts + v1.1–v1.4 capabilities

> Per-capability parity across the three first-class runtime adapters. Updated for planr-pipeline v0.37.1.

## TL;DR

OpenPlanr ships three runtime adapters that all consume the same protocol artifacts:

| Runtime | Install | Adapter |
|---|---|---|
| Claude Code | `planr setup --runtime claude` | Native commands and tool-enforced agents sourced from the portable package |
| Cursor | `planr setup --runtime cursor` | Portable project rules, nine role files, and Composer handoff |
| Codex | `planr setup --runtime codex` | User skills, concise project policy, and dynamic subagent fallback |

Same `.planr/specs/` directories. Same SPEC, US, Task, stack, graph, and `.pipeline-shipped` schemas. Runtime adapters differ in orchestration capabilities, but artifacts remain portable.

## Capability Matrix

| Capability | Claude Code | Cursor | Codex |
|---|---|---|---|
| PLAN orchestration | Native slash command or router | Composer handoff from router | Installed `$planr-plan` skill or headless router |
| SHIP orchestration | Native slash command or router | Composer handoff with sequential fallback | Installed `$planr-ship` skill; native subagents when exposed |
| R1 plan/ship separation | Enforced by separate commands and prompts | Enforced by generated rules | Enforced by generated agent instructions |
| Spec-driven mode | Supported | Supported | Supported |
| Default mode | Supported | Supported | Supported |
| `.pipeline-shipped` marker | Writes `runtime: claude-code` | Writes `runtime: cursor` | Writes `runtime: codex` |
| `qa_gate_status` values | `passed`, `failed`, `skipped` | Same schema | Same schema |
| Subagent/tool isolation | Manifest-enforced | Advisory/host capabilities | Dynamic native support; sequential role fallback |
| Multi-task ship dispatch | Native ready-task fan-out | Host-dependent; sequential fallback | Dynamic ready-task fan-out; sequential fallback |
| `dependsOn` ordering | Supported | Supported | Supported |
| Workflow dispatch style | Supported on Claude Code where available | Not supported | Not supported |
| Preserve-list protection | Runtime instruction plus conformance diff check | Conformance diff check | Conformance diff check |
| Project memory | Orchestrator-managed read/write | Prompt-driven read/write | Prompt-driven read/write |
| Design generation command | Native and `planr pipeline design` | Router handoff | `$planr-design` / router |
| Design loop / review board | Available | Available through router handoff | Available through installed skill/router |
| Universal HTML artifact review | `planr artifact` | `planr artifact` handoff | Installed `$planr-artifact` skill invoking `planr` |
| Headless document / canvas presentation | Same generated renderer | Same generated renderer | Same generated renderer |
| Local pins, threads, and decisions | Supported | Supported | Supported |
| Fragment sharing | Supported | Supported | Supported |
| Encrypted expiring short links | Supported | Supported | Supported |
| Review import/export | Supported | Supported | Supported |
| Dashboard command | Available | Available through router | `$planr-dashboard` / router |
| Operating Board | `/planr-pipeline:operate` → `planr operate` | Generated `planr operate` rule | Installed `$planr-operate` skill |
| Guided Operating questions | Native when the active host verifies the question surface; chat/terminal/handoff fallback | Structured Composer chat; terminal/handoff fallback | Native when dynamically reported; structured chat, terminal, then handoff |
| Operating state transitions | OpenPlanr engine | OpenPlanr engine | OpenPlanr engine |
| Operating execution | Runtime-native agents, sticky Claude binding | Same-runtime sequential Composer fallback | Runtime-native agents, sticky Codex binding |
| Operating assurance | Runtime-governed; enforced isolation reported | Runtime-governed; advisory isolation reported | Runtime-governed; advisory isolation supported |
| Operating project research | Agents inspect workspace directly | Same contract | Same contract |
| Operating reports/drafts | Markdown + JSON + canonical proposals | Same contract | Same contract |
| Sync command | Available | Available through router | `$planr-sync` / router |
| Status command | Native and router | Router | Router/skill |
| Conformance | Canonical local conformance suite | Artifact conformance target | Artifact conformance target |

## Current Guarantees

Compatibility is reported at three explicit levels:

- **Artifact:** a SPEC authored by OpenPlanr CLI or one runtime can be consumed by the others.
- **Workflow:** PLAN, Design, SHIP, dashboard, status, and sync are reachable through the adapter.
- **Product:** native runtime enforcement and the full host-integrated experience.
- Protocol v1.2/v1.3 Operating Board events remain readable. Protocol v1.4 adds
  runtime bindings, research mandates, epistemic context, agent-native reports,
  external citations, interaction surfaces, and materialized proposal drafts.
- Operating events, immutable records, checkpoints, routes,
  and outcomes are runtime-neutral. Runtime guidance delegates to `planr
  operate`; it does not reimplement state transitions.
- All adapters preserve the same governance boundaries: `--preview` makes no
  provider/model calls or writes, `--dry-run` may use a consented provider but
  commits no state, finding acceptance is separate from route application,
  answered gaps require evidence-backed verification, Pipeline-PO DEV routes
  resume from `awaiting-plan`, and outcome reconciliation observes but never
  invokes SHIP.
- Protocol v1.2 guided questions and typed actions keep OpenPlanr as the
  behavioral owner. Adapter `interactiveQuestions` metadata controls
  presentation only and cannot authorize a write, provider call, PLAN, or SHIP.
- The interaction resolver treats the registry mode as a ceiling rather than
  proof that a runtime tool is present. It selects native UI only from a
  positive active-runtime report and emits a named downgrade diagnostic for
  chat, attached-terminal, or fail-closed handoff.
- Native, chat, and terminal adapters submit the same typed, bounded answer
  envelope. Runtime identity and submission time are excluded from the reduced
  preview input, so equivalent answers remain byte-equivalent across transports.
  Every non-read-only structured action is confirmed independently with the
  exact digest returned by the CLI.
- Stories, tasks, stack files, design specs, graph output, run manifests, and shipped markers use schemas under `schemas/v1.0.0/`.
- The canonical schema source for this cleanup cycle is `planr-pipeline/schemas/v1.0.0/`; OpenPlanr CLI docs mirror that contract for CLI users.

The runtime guarantee is not identical tool behavior:

- Claude Code reports enforced isolation where its host provides it.
- Cursor uses generated portable rules and host handoff; its restrictions remain advisory.
- Codex is an equal first-class executor. It uses durable skills, native
  subagents when exposed, and a same-runtime sequential fallback. Advisory
  isolation is transparent metadata, not an unsupported classification.
- No adapter silently switches vendors during an Operating cycle.

## Dispatch Modes

`/planr-pipeline:ship` binds dispatch behavior from the runtime:

| Runtime | Default behavior | Reason |
|---|---|---|
| Claude Code | `multi-task` | The host can dispatch isolated subagents; ready tasks can fan out safely when `dependsOn` is satisfied. |
| Cursor | host-dependent, sequential fallback | Composer owns dispatch capability. |
| Codex | dynamic, sequential fallback | Native subagents are used when the runtime exposes them. |

The engine always computes the same ready-task DAG. Each adapter chooses native
parallel dispatch only when its capability report supports it and otherwise uses
the sequential fallback.

## Design Tooling Parity

Design generation and the design-loop/review board are package-owned tools exposed by all certified adapters. Cursor initially uses a native handoff because Composer owns execution.

Portable outputs:

- `design-spec.md`
- `finalized.json`
- approved design artifacts copied into the repo
- task decomposition behavior that consumes those artifacts

Adapter entrypoints cover:

- Interactive source/format clarification
- Local design and review boards
- Taste profiles and design sessions
- Provider setup through the shared engine

Design artifacts and board state are portable. The adapter changes only how the
runtime launches or hands off the package-owned tooling.

## Artifact Review Parity

Artifact review is a package-owned workflow exposed through the public `planr`
router on every certified runtime. Only `planr` is required on `PATH`; generated
skills and rules never invoke the nested `planr-pipeline` binary.

The portable contract includes:

- Local, loopback-only review of self-contained HTML.
- Headless `document` presentation for generic artifacts and zoomable `canvas`
  presentation for design boards and spatial comparison workflows.
- The shared annotation shell, including pins, threads, identities, decisions,
  JSON/Markdown export, and ordered multi-variant envelopes.
- Explicit fragment sharing for payloads at or below 8,000 characters.
- Explicit AES-256-GCM encrypted short links with 1/7/30-day expiry when a
  payload is larger or the user selects `--short`.
- Non-destructive review import with digest validation and an explicit stale
  review override.

The shell and Protocol v1.1 schemas are identical across runtimes. Adapter
differences affect invocation only: Claude Code uses native assets, Cursor uses
Composer handoff, and Codex uses the installed `$planr-artifact` skill. Sharing
never occurs automatically from design, PLAN, or SHIP.

Fragment links are encoded, not encrypted, and their content remains in the URL
fragment. Short links upload ciphertext and request metadata; the decryption key
stays in the fragment and is never sent to the service. See
[`artifact-review.md`](artifact-review.md) for the complete privacy and sandbox
contract.

## Caveats

### Cursor and Codex restrictions are runtime-governed

Claude Code may enforce per-agent tools through plugin manifests. Cursor and
Codex govern workspace access through their active session permissions. Planr
does not widen those permissions; it validates cited results before persistence
and refuses governed writes when validation fails.

### Snapshot hooks differ by runtime

Claude Code can use plugin lifecycle behavior to remind users about snapshots and shipped state. Cursor and Codex do not have the same hook surface, so `.pipeline-shipped` remains the primary audit marker.

### Compatibility should be tested, not trusted

Use the conformance suite for protocol-level behavior:

```bash
npm run conformance:check
```

For runtime-operated fixtures, use `conformance/runner.mjs` with `--setup`, then verify PO and SHIP state against the runtime-produced workspace.

## See Also

- `protocol/README.md` - protocol overview
- `protocol/spec-artifacts.md` - artifact schemas and marker examples
- `protocol/agent-roles.md` - role contracts
- `protocol/commands.md` - PLAN and SHIP contracts
- `protocol/runtime-adapters.md` - adapter details
- `artifact-review.md` - artifact engine, CLI, privacy, and integration contract
- `../conformance/README.md` - conformance workflow

---

*OpenPlanr Protocol v1.0 artifacts + v1.1–v1.4 ecosystem contracts — compatibility matrix for planr-pipeline v0.37.1.*
