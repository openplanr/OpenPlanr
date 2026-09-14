# OpenPlanr Ecosystem Ownership Map

This map keeps canonical workspace domains and their generated projections from
drifting. Change the owning domain first, then regenerate and check every public
projection.

## Domains

| Domain | Owns | Projects into |
|---|---|---|
| `packages/cli` | Planning, setup, runtime lifecycle, routing, locks, rollback, and unified Doctor | Public `openplanr` package |
| `packages/pipeline` | PO–Design–DEV engine and self-contained public compatibility surface | Public `planr-pipeline` package |
| `packages/protocol` | Canonical schemas, registries, catalogs, and browser-safe contracts | CLI, pipeline, adapters, and dashboard projections |
| `packages/operate` | Operate runtime | Pipeline and CLI compatibility projections |
| `packages/artifact` and `packages/design` | Artifact review and design runtimes | Pipeline, CLI, and dashboard projections |
| `skills/`, `agents/`, `packages/skill-runtime` | Canonical workflows, roles, and composition | `adapters/` and pipeline compatibility assets |
| `.claude-plugin/` and `ecosystem.json` | Generated workspace distribution metadata | Local and future published host manifests |
| external `openplanr-web` | Independently deployed web property and hosted transport | Canonical artifact and transport contracts |

## Canonical Contracts

| Contract | Owner | Required check |
|---|---|---|
| Protocol schemas | `packages/protocol` | protocol tests, generated-asset check, and conformance |
| Adapter and delivery-role registries | `packages/protocol` | schema tests, generated-asset check, and portable-asset scan |
| Operate event/replay/checkpoint contracts (Protocol 2.0) | `packages/protocol` and `packages/operate` | Operate conformance |
| Guided question, answer, session, action, and diagnostic contracts | `packages/protocol` | guided-contract and Operate conformance tests |
| Guided question wording, validation, sessions, confirmations, and mutations | `packages/cli` | focused CLI interaction tests |
| Hosted artifact and live-room transport | `openplanr-web` | `npm test`, `npm run share:check`, and `npm run build` |
| Ecosystem release operation | root scripts plus public packages | saga and release-operation tests |
| Public package proof and strict consumption | root workspace | `npm run verify:packed:strict` |
| Runtime lock and migration | `packages/cli` | setup/idempotency/rollback tests |
| Provenance event schema | `packages/protocol` | schema validation in both planning engines |
| `.pipeline-shipped` marker | `packages/protocol` | schema tests plus markdown contract tests |
| Graph JSON schema | `packages/protocol` | graph schema tests and conformance |
| CLI graph output | `packages/cli` | CLI tests against the graph schema |
| Skill routing language | `skills/` | generation, stale-reference, and adapter parity checks |
| Marketplace metadata and compatibility manifest | root generators | `npm run generate && npm run check:generated` |
| Ecosystem health | pipeline Doctor plus root checks | `planr doctor --strict` and `npm run verify` |
| Skill evaluation | `evaluation/` | evaluation and skill conformance tests |

## Skill Certification Boundary

The skill evaluation laboratory (`docs/skill-evaluation.md`) supersedes SPEC-021's
ad-hoc skill, host, and canary checking **for measurement and certification
only**. What a skill-host pair must demonstrate, how it is measured, and what
verdict that produces are owned here.

SPEC-021 stays authoritative and byte-unchanged for what it has always owned:
the frozen professional-skill catalog membership and its bundle digests, the
canonical skill sources and generated host assets, the frozen command grammar,
and the specialist roster. The laboratory reads all of them through their
existing public loaders and never forks, edits, or reinterprets their records.

A certified skill-host result asserts skill compatibility for that host profile
only. It confers no PLAN, SHIP, or Operate runtime compatibility, and no
release, publish, deploy, promotion, or activation authority.

## Change Order

1. Change the canonical owner domain.
2. Add or update its focused check.
3. Run `npm run generate` from the workspace root.
4. Run `npm run check:generated`, focused tests, and `planr doctor --strict`.
5. Follow `docs/release-checklist.md` only for a separately scheduled release.

## Current Protocol Decision

`packages/protocol/schemas/` is the canonical schema source. The corresponding
`packages/pipeline/schemas/` files are generated compatibility projections so
the public pipeline tarball remains self-contained. v1.0 planning artifacts and
additive shared capability contracts remain readable. Operate uses Protocol 2.0
as its runtime foundation.

Adapter `interactiveQuestions` values describe only how a validated
questionnaire can be presented. They never confer mutation or provider
authority; OpenPlanr remains the authority owner.
