# OpenPlanr Protocol

> Version: **1.0.0**
> Status: **stable** for schemaVersion `1.0.0`. Current canonical executor docs are verified against planr-pipeline v0.24.9.
> Ownership: `planr-pipeline/schemas/v1.0.0/` is canonical for this cleanup cycle; downstream CLI, skill, and marketplace docs mirror it.

The OpenPlanr Protocol is the runtime-agnostic contract for spec-driven AI development. It defines:

- **Spec artifacts** — the directory layout and YAML frontmatter for SPECs, User Stories, Tasks, design specs, error reports, qa reports, and the `.pipeline-shipped` execution marker.
- **Agent roles** — 8 named roles with input/output contracts, tool-use guardrails, and model-tier guidance.
- **Commands** — `PLAN` and `SHIP` defined as command contracts (inputs, validation, mode detection, orchestration, exits).
- **Workflow** — PO Phase → mandatory human review → DEV Phase. Hard rule R1 prohibits auto-chaining.

## Why a protocol

OpenPlanr ships across multiple repos and three first-class AI coding agent runtimes:

| Component | Role | Repo |
|---|---|---|
| `planr` CLI | Authoring surface — generates `.planr/` markdown artifacts | `openplanr/OpenPlanr` |
| `planr-pipeline` | Claude Code plugin — canonical pipeline executor, schema owner, and conformance source | `openplanr/planr-pipeline` |
| `openplanr` skill | Routing playbook — teaches Claude when to use which surface | `openplanr/skills` |
| `openplanr/marketplace` | Distribution — Claude Code plugin registry metadata | `openplanr/marketplace` |

The same workflow runs on **Claude Code** (canonical), **Cursor** (via planr-generated `.cursor/rules/planr-pipeline.mdc` + agent body files), and **Codex** (via `AGENTS.md` with a pipeline section). All three runtimes share the same artifact contract — a SPEC authored on one runtime is consumable by any other.

The protocol is the contract. Runtimes are adapters.

## Files in this directory

| File | What it defines |
|---|---|
| `spec-artifacts.md` | YAML frontmatter for SPEC, US, Task. Body-section structure. `.pipeline-shipped` marker schema. v1.0.0 schema reference. |
| `agent-roles.md` | 8 roles (db, designer, specification, frontend, backend, qa, devops, doc-gen). Inputs, outputs, tool guardrails, model tier. |
| `commands.md` | `PLAN` and `SHIP` as command contracts. Mode detection, validation, orchestration, exits. R1 normative. |
| `runtime-adapters.md` | How Claude Code plugin, Cursor MDC rules, and Codex AGENTS.md implement this protocol. |

## Pinning rule

`schemaVersion: "1.0.0"` is required on every spec, story, and task. Future breaking changes will bump this version in lockstep across all three runtimes; readers MUST refuse mismatched versions.

Canonical schema source for this cleanup cycle: [`../../schemas/v1.0.0/`](../../schemas/v1.0.0/). The OpenPlanr CLI schema reference is a downstream mirror for CLI users.

## Compatibility matrix

See [`../compatibility-matrix.md`](../compatibility-matrix.md) for the per-capability parity table across Claude Code, Cursor, and Codex.

## Conformance

The `planr-pipeline/conformance/` directory ships a runtime-agnostic test fixture (`feat-todo`) and verifier (`runner.mjs`). Each runtime adapter is tested against the same fixture. Pass criteria: post-PO state matches expected decomposition, post-DEV state has `.pipeline-shipped` marker validating against schema, no Preserve files mutated.

---

*OpenPlanr Protocol v1.0.0. The contract is markdown; runtimes are adapters.*
