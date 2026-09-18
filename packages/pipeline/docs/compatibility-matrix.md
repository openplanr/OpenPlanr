# Compatibility Matrix - Protocol artifacts, shared capabilities, and Operate

> Per-capability parity across the three first-class runtime adapters.

Package versions are declared in `packages/cli/package.json`,
`packages/pipeline/package.json`, and `packages/protocol/package.json`.
Document and schema versions identify their contracts independently. Release
verification binds the three generated package identities to their packed
archives through `ecosystem.json` and the packed-workspace proof; this capability
matrix does not duplicate release numbers. `skills/` and marketplace metadata
are generated catalog domains, and the hosted service remains an independent
consumer. See [`release-ledger.md`](release-ledger.md) for proof boundaries and
historical release compatibility.

## TL;DR

OpenPlanr ships three runtime adapters that all consume the same protocol artifacts:

| Runtime | Install | Adapter |
|---|---|---|
| Claude Code | `planr setup --runtime claude` | Native skills and agents generated from the canonical workspace sources |
| Cursor | `planr setup --runtime cursor` | Portable project rules, nine role files, and Composer handoff |
| Codex | `planr setup --runtime codex` | User skills, concise project policy, and dynamic subagent fallback |

Same `.planr/specs/` directories. Same SPEC, US, Task, stack, graph, and `.pipeline-shipped` schemas. Runtime adapters differ in orchestration capabilities, but artifacts remain portable.

## Capability Matrix

| Capability | Claude Code | Cursor | Codex |
|---|---|---|---|
| Operate machine client | `/planr:operate` skill over `planr operate ... --json` | `openplanr-operate.mdc` over the same machine commands | Installed `$planr-operate` skill over the same machine commands |
| Operate public domains | Installed `business@1.0.0` and `software@1.0.0` registrations through one OpenPlanr composition | Same installed registrations and composition | Same installed registrations and composition |
| Operate Planning handoff | Exact preview, separate human confirmation, exact create-SPEC digest | Same machine result and gate | Same machine result and gate |
| PLAN orchestration | Native slash command or router | Composer handoff from router | Installed `$planr-plan` skill or headless router |
| SHIP orchestration | Native slash command or router | Composer handoff with sequential fallback | Installed `$planr-ship` skill; native subagents when exposed |
| R1 plan/ship separation | Enforced by separate commands and prompts | Enforced by generated rules | Enforced by generated agent instructions |
| Spec-driven mode | Supported | Supported | Supported |
| Default mode | Supported | Supported | Supported |
| `.pipeline-shipped` marker | Writes `runtime: claude-code` | Writes `runtime: cursor` | Writes `runtime: codex` |
| Authoritative SHIP receipt | Immutable Protocol 1.1 receipt | Same receipt through sequential fallback | Same receipt through native dispatch/fallback |
| `qa_gate_status` values | `passed`, `failed`, `skipped` | Same schema | Same schema |
| Subagent/tool isolation | Manifest-enforced | Advisory/host capabilities | Dynamic native support; sequential role fallback |
| Multi-task ship dispatch | Native ready-task fan-out | Host-dependent; sequential fallback | Dynamic ready-task fan-out; sequential fallback |
| `dependsOn` ordering | Supported | Supported | Supported |
| Coherent invocation | Drains the ready graph | Drains sequentially in one invocation | Drains with native subagents when exposed |
| Preserve protection | Engine-verified repository boundaries | Same engine verification | Same engine verification |
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
| Guided questions | Native when the active host verifies the question surface; chat/terminal/handoff fallback | Structured Composer chat; terminal/handoff fallback | Native when dynamically reported; structured chat, terminal, then handoff |
| Operate runtime | Published package contracts, strict reader, guard/action table, and deterministic replay | Same package contract | Same package contract |
| Operate runtime types | Declared `protocol` and `operate/runtime-v2` exports | Same declarations | Same declarations |
| Sync command | Available | Available through router | `$planr-sync` / router |
| Status command | Native and router | Router | Router/skill |
| Conformance | Canonical local conformance suite | Artifact conformance target | Artifact conformance target |
| Certified skill compatibility | Measured per host profile by the evaluation laboratory | Same laboratory, same host profile contract | Same laboratory, same host profile contract |

## Current Guarantees

Compatibility is reported at three explicit levels:

- **Artifact:** a SPEC authored by OpenPlanr CLI or one runtime can be consumed by the others.
- **Workflow:** PLAN, Design, SHIP, dashboard, status, and sync are reachable through the adapter.
- **Product:** native runtime enforcement and the full host-integrated experience.
- Operate's Protocol 2.0 runtime exposes strict runtime contracts, an
  explicit version reader, a bounded Assignment lifecycle, complete typed
  actions, hash-chain replay, durable binding checks, and no v1 reader,
  translator, migration path, or compatibility transaction.
- Operate adapters are presentation clients only. They call OpenPlanr machine
  JSON, preserve returned ordering/reason/action arguments, and ask only for a
  missing human choice. They contain no lifecycle, authority, recovery,
  ranking, or Planning transaction implementation.
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
- The canonical schema source is `packages/protocol/schemas/`, published as `@openplanr/protocol`. CLI and pipeline retain self-contained compatibility projections.

The runtime guarantee is not identical tool behavior:

- Claude Code reports enforced isolation where its host provides it.
- Cursor uses generated portable rules and host handoff; its restrictions remain advisory.
- Codex is an equal first-class executor. It uses durable skills, native
  subagents when exposed, and a same-runtime sequential fallback. Advisory
  isolation is transparent metadata, not an unsupported classification.

## Dispatch Modes

`/planr:ship` binds dispatch behavior from the runtime:

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

## Certified Skill Compatibility

The skill evaluation laboratory grades every public skill in the frozen catalog
against each registered host profile and issues one readiness receipt per skill.
See [`skill-evaluation.md`](skill-evaluation.md) for corpora, journeys, gates,
and waiver rules.

Read a certified skill-host result narrowly:

- It asserts **skill compatibility for that host profile only** — the skill
  routes on its declared triggers, completes its journeys, produces
  contract-valid output, and matches declared asset, export, and package parity
  on that host.
- It does **not** imply PLAN, SHIP, or Operate runtime compatibility. Those are
  the Artifact/Workflow/Product levels above and are certified separately; a
  runtime is covered only when it was certified in the same run.
- It confers no release, publish, deploy, promotion, or activation authority.
  The receipt records readiness, and its contract refuses any field a reader
  could mistake for authority.
- Each receipt names exactly the host profiles its run graded. A host profile
  that was not graded is absent, never assumed.

The laboratory supersedes the frozen catalog record's ad-hoc skill/host/canary checking for
measurement and certification only. The frozen catalog membership, canonical
skill sources, generated host assets, command grammar, and specialist roster
remain the frozen catalog record's and are read unchanged. See
[`ownership-map.md`](ownership-map.md).

## Caveats

### Cursor and Codex restrictions are runtime-governed

Claude Code may enforce per-agent tools through plugin manifests. Cursor and
Codex govern workspace access through their active session permissions. OpenPlanr
does not widen those permissions; it validates cited results before persistence
and refuses governed writes when validation fails.

### Terminal closure is runtime-neutral

No adapter uses a lifecycle hook to restart, finalize, or reopen SHIP. The immutable
closure receipt is authoritative across runtimes; `.pipeline-shipped` is a derived
legacy projection only.

### Compatibility should be tested, not trusted

Use the conformance suite for protocol-level behavior:

```bash
npm run conformance:check
```

For consolidated release custody, generate the root packed-workspace proof and
pass it to the pipeline ledger verifier with `--strict --proof`. This proves the
public `openplanr`, `planr-pipeline`, and `@openplanr/protocol` artifacts without requiring local
package rows for the generated skills/marketplace catalogs or the external web
deployment.

For runtime-operated fixtures, use `conformance/runner.mjs` with `--setup`, then verify PO and SHIP state against the runtime-produced workspace.

## See Also

- `protocol/README.md` - protocol overview
- `protocol/spec-artifacts.md` - artifact schemas and marker examples
- `protocol/agent-roles.md` - role contracts
- `protocol/commands.md` - PLAN and SHIP contracts
- `protocol/runtime-adapters.md` - adapter details
- `artifact-review.md` - artifact engine, CLI, privacy, and integration contract
- `skill-evaluation.md` - skill certification corpora, journeys, gates, and waivers
- `../conformance/README.md` - conformance workflow

---

*Capabilities are verified through Protocol conformance and the three-package
packed-workspace proof. Package releases and schema versions are independent.*
