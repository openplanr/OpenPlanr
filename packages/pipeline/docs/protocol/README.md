# OpenPlanr Protocol

> Artifact version: **1.0.0**
> Ecosystem contracts: **1.1.0 + Operate Runtime 2.0.0**
> Status: v1.0 artifact frontmatter remains stable. v1.1 adds optional adapter,
> runtime-lock, role-registry, provenance, and artifact-review contracts.
> Operate Runtime 2.0 adds the durable Assignment/tool/replay foundation.
> Ownership: `packages/protocol/schemas/` is canonical in the OpenPlanr workspace;
> `planr-pipeline/schemas/` is its self-contained public-package projection.
> Current development baseline: planr-pipeline v0.44.0.

The OpenPlanr Protocol is the runtime-agnostic contract for spec-driven AI development. It defines:

- **Spec artifacts** — the directory layout and YAML frontmatter for SPECs, User Stories, Tasks, design specs, error reports, qa reports, and the `.pipeline-shipped` execution marker.
- **Agent roles** — 9 named roles, including the optional entity-scaffold role,
  with input/output contracts, tool-use guardrails, and capability-tier guidance.
- **Commands** — `PLAN` and `SHIP` defined as command contracts (inputs, validation, mode detection, orchestration, exits).
- **Workflow** — Spec, Plan, optional Review, and Ship are guidance-first entry
  points. R1 follows the scope already authorized by the user.
- **Artifact review** — portable HTML envelopes, encrypted live-room events,
  immutable snapshots, and ciphertext-only sharing boundaries without changing
  planning frontmatter.
- **Operate Runtime 2.0** — strict cycle/input/Assignment/submission/Artifact
  identities, complete typed actions, deterministic replay, and fail-closed
  version selection.

## Why a protocol

OpenPlanr ships across multiple workspace domains and three first-class AI coding agent runtimes:

| Component | Role | Canonical source |
|---|---|---|
| `planr` CLI | Dedicated planning, artifact lifecycle, setup, routing, and Doctor | `packages/cli` |
| `planr-pipeline` | Complete PO, Design, DEV, and QA public compatibility package | `packages/pipeline` |
| Protocol | Schemas, registries, and portable contracts | `packages/protocol` |
| runtime skills | Reusable planning and delivery workflows | `skills/` and `agents/` |
| marketplace | Generated Claude metadata and resolved compatibility manifest | `.claude-plugin/` and `ecosystem.json` |
| hosted web | Independently deployed artifact and room transport | external `openplanr-web` repository |

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
| `../operate/README.md` | Source-checkout-only canonical Operate handoff: current branch truth, executive-board requirement, dashboard status, and continuation plan. |
| `../artifact-review.md` | Engine API, `planr artifact` commands, sandbox, privacy, sharing, and design-board integration. |
| `operate-runtime-v2.md` | Technical Protocol 2.0 reference: contract identities, bounded lifecycle, guards/actions, replay, exact-byte metadata, and package exports. Product vision and current status live in the Operate handoff hub. |
| `../generated/roles.md` | Generated nine-role registry table. |
| `../generated/adapters.md` | Generated certified-adapter capability table. |

## Pinning rule

`schemaVersion: "1.0.0"` is required on every spec, story, and task. Future breaking changes will bump this version in lockstep across all three runtimes; readers MUST refuse mismatched versions.

The v1.0 artifact schemas additionally accept two OPTIONAL, sync-tool-written
board-sync identity fields — `kanbanosId` and `contentHash` — written back by
the kanbanos hosted-board sync after a successful push (the `linearId`
precedent from the OpenPlanr CLI Linear integration). The amendment is
backward-compatible: artifacts without the fields stay valid, unknown fields
(including any rank/ordering field, which is deliberately excluded) are still
rejected, and `schemaVersion` stays `"1.0.0"`. See
[`spec-artifacts.md`](spec-artifacts.md) and ADR-012.

Canonical workspace schemas live in `packages/protocol/schemas/`. This public
package retains [`../../schemas/v1.0.0/`](../../schemas/v1.0.0/) and additive
versions as generated, self-contained compatibility assets.

Additive ecosystem contracts live under [`../../schemas/v1.1.0/`](../../schemas/v1.1.0/).
They do not invalidate or rewrite v1.0 artifact frontmatter.

Artifact review adds these v1.1 schemas:

- `artifact-envelope.schema.json` — one or more ordered, self-contained HTML
  artifacts plus frozen viewer state and optional feedback.
- `artifact-review.schema.json` — review identity, decision, overall feedback,
  normalized pins, anchors, replies, authors, and timestamps.
- `artifact-paste.schema.json` — create/created/stored shapes for the encrypted,
  expiring short-link boundary.
- `artifact-room-event.schema.json` — encrypted append-only event plaintext for
  live artifact rooms; the service stores only the ciphertext record.
- `artifact-theme.schema.json` — the canonical generated light/dark review-shell
  design tokens.

These schemas use `schemaVersion: "1.0.0"` for their own payload format while
living in the additive Protocol v1.1 capability namespace. They are not SPEC,
story, or task frontmatter and do not alter existing Protocol v1.0 artifacts.

Operate Runtime contracts live under
[`../../schemas/v2.0.0/`](../../schemas/v2.0.0/). They are the current
development foundation. A v2 runtime accepts only its declared v2 contract
kinds and fails closed for missing, mixed, or unknown identity; it does not
read, translate, or migrate a prior Operate runtime. See
[`operate-runtime-v2.md`](operate-runtime-v2.md).

## Artifact review workflow

The public entrypoint is `planr artifact`; runtime guidance must not call a
globally installed nested pipeline executable. Local review is loopback-only and
sharing is always explicit. New generic shares use an encrypted live room: the
ordinary URL can view and comment; a separate owner-verdict URL plus its
client-held signing key can approve or request changes; and a management URL
can only pause/reopen comments or delete the room. Browser creation downloads a
full recovery bundle (all three scoped URLs plus the private owner key) before
making the room request and retains one opaque prepared attempt for exact retry
after an ambiguous response. Exact server replay returns the same receipt;
divergent, deleted, and expired identities fail closed. Small fragment
and encrypted short links remain explicit immutable snapshot alternatives. The
service stores ciphertext and the owner public key, never the private signer;
importing either a room or snapshot validates the reviewed digest and merges
feedback non-destructively.

## Compatibility matrix

See [`../compatibility-matrix.md`](../compatibility-matrix.md) for the per-capability parity table across Claude Code, Cursor, and Codex.

## Conformance

The `planr-pipeline/conformance/` directory ships runtime-agnostic fixtures and
verifiers. Delivery adapters use `runner.mjs`; Operate Runtime 2.0 uses
`verify-operating-runtime-v2.mjs` through `npm run conformance:operate-v2`.
The v2 runner consumes only declared package exports and proves strict readers,
deferred-value rejection, bindings, legal/illegal walks, guard/action
equivalence, exact bytes, and deterministic replay.

---

*OpenPlanr Protocol v1.0.0. The contract is markdown; runtimes are adapters.*
