# OpenPlanr Protocol

> Artifact version: **1.0.0**
> Ecosystem contracts: **1.1.0**
> Status: v1.0 artifact frontmatter remains stable. v1.1 adds optional adapter,
> runtime-lock, compatibility, role-registry, provenance, and artifact-review contracts.
> Ownership: `planr-pipeline/schemas/` is canonical; downstream CLI, skill, and marketplace docs mirror it. Current engine: planr-pipeline v0.26.0.

The OpenPlanr Protocol is the runtime-agnostic contract for spec-driven AI development. It defines:

- **Spec artifacts** — the directory layout and YAML frontmatter for SPECs, User Stories, Tasks, design specs, error reports, qa reports, and the `.pipeline-shipped` execution marker.
- **Agent roles** — 9 named roles, including the optional entity-scaffold role,
  with input/output contracts, tool-use guardrails, and capability-tier guidance.
- **Commands** — `PLAN` and `SHIP` defined as command contracts (inputs, validation, mode detection, orchestration, exits).
- **Workflow** — PO Phase → mandatory human review → DEV Phase. Hard rule R1 prohibits auto-chaining.
- **Artifact review** — portable HTML envelopes, immutable structured feedback,
  and ciphertext-only paste boundaries without changing planning frontmatter.

## Why a protocol

OpenPlanr ships across multiple repos and three first-class AI coding agent runtimes:

| Component | Role | Repo |
|---|---|---|
| `planr` CLI | Dedicated planning, artifact lifecycle, setup, routing, and doctor | `openplanr/OpenPlanr` |
| `planr-pipeline` | Complete PO, Design, DEV, and QA engine; schema and conformance owner | `openplanr/planr-pipeline` |
| runtime skills | Reusable planning and delivery workflows | `openplanr/skills` |
| marketplace | Claude metadata plus resolved compatibility manifest | `openplanr/marketplace` |

The same workflow runs on **Claude Code** through native plugin assets, **Cursor**
through portable rules and handoff, and **Codex** through installed skills plus
dynamic subagent fallback. All three share the same artifact contract.

The protocol is the contract. Runtimes are adapters.

## Files in this directory

| File | What it defines |
|---|---|
| `spec-artifacts.md` | YAML frontmatter for SPEC, US, Task. Body-section structure. `.pipeline-shipped` marker schema. v1.0.0 schema reference. |
| `agent-roles.md` | 9 roles, including optional entity-scaffold. Inputs, outputs, tool guardrails, capability tier. |
| `commands.md` | `PLAN` and `SHIP` as command contracts. Mode detection, validation, orchestration, exits. R1 normative. |
| `runtime-adapters.md` | How Claude Code plugin, Cursor MDC rules, and Codex AGENTS.md implement this protocol. |
| `../artifact-review.md` | Engine API, `planr artifact` commands, sandbox, privacy, sharing, and design-board integration. |
| `../generated/roles.md` | Generated nine-role registry table. |
| `../generated/adapters.md` | Generated certified-adapter capability table. |

## Pinning rule

`schemaVersion: "1.0.0"` is required on every spec, story, and task. Future breaking changes will bump this version in lockstep across all three runtimes; readers MUST refuse mismatched versions.

Canonical schema source for this cleanup cycle: [`../../schemas/v1.0.0/`](../../schemas/v1.0.0/). The OpenPlanr CLI schema reference is a downstream mirror for CLI users.

Additive ecosystem contracts live under [`../../schemas/v1.1.0/`](../../schemas/v1.1.0/).
They do not invalidate or rewrite v1.0 artifact frontmatter.

Artifact review adds these v1.1 schemas:

- `artifact-envelope.schema.json` — one or more ordered, self-contained HTML
  artifacts plus frozen viewer state and optional feedback.
- `artifact-review.schema.json` — review identity, decision, overall feedback,
  normalized pins, anchors, replies, authors, and timestamps.
- `artifact-paste.schema.json` — create/created/stored shapes for the encrypted,
  expiring short-link boundary.
- `artifact-theme.schema.json` — the canonical generated light/dark review-shell
  design tokens.

These schemas use `schemaVersion: "1.0.0"` for their own payload format while
living in the additive Protocol v1.1 capability namespace. They are not SPEC,
story, or task frontmatter and do not alter existing Protocol v1.0 artifacts.

## Artifact review workflow

The public entrypoint is `planr artifact`; runtime guidance must not call a
globally installed nested pipeline executable. Local review is loopback-only and
sharing is always explicit. Small shares keep their encoded payload in the URL
fragment. Large or explicitly short shares are compressed and encrypted in the
client, and the key remains in the fragment while the service stores ciphertext
only. A reviewer returns immutable feedback with a new review URL, which the
originator validates and imports non-destructively.

## Compatibility matrix

See [`../compatibility-matrix.md`](../compatibility-matrix.md) for the per-capability parity table across Claude Code, Cursor, and Codex.

## Conformance

The `planr-pipeline/conformance/` directory ships a runtime-agnostic test fixture (`feat-todo`) and verifier (`runner.mjs`). Each runtime adapter is tested against the same fixture. Pass criteria: post-PO state matches expected decomposition, post-DEV state has `.pipeline-shipped` marker validating against schema, no Preserve files mutated.

---

*OpenPlanr Protocol v1.0.0. The contract is markdown; runtimes are adapters.*
