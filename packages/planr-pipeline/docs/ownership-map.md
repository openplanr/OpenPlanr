# OpenPlanr Ecosystem Ownership Map

This map keeps the four OpenPlanr repos from drifting. When a behavior changes,
the owning repo changes first; downstream repos mirror the contract only after
the owner is updated and checked.

## Repos

| Repo | Owns | Mirrors |
|---|---|---|
| `openplanr/OpenPlanr` | CLI planning, agile artifacts, spec authoring, generated runtime rules, CLI release notes | Protocol schemas from `planr-pipeline/schemas/v1.0.0/` |
| `openplanr/planr-pipeline` | Claude Code execution, protocol schemas, conformance, plugin commands, dashboard, design board, release doctor | CLI behavior needed for execution handoff |
| `openplanr/skills` | Skill routing, user guidance for choosing CLI vs plugin vs generated rules | Current CLI, pipeline, and marketplace versions |
| `openplanr/marketplace` | Claude Code marketplace metadata and install records | Released plugin and skill versions |

## Canonical Contracts

| Contract | Owner | Required check |
|---|---|---|
| Protocol schemas | `planr-pipeline` | `npm run test:schema` and `npm run conformance:check` |
| `.pipeline-shipped` marker | `planr-pipeline` | schema tests plus markdown contract tests |
| Graph JSON schema | `planr-pipeline` | graph schema tests and cross-repo conformance |
| CLI graph output | `OpenPlanr` | CLI tests against the graph schema |
| Skill routing language | `skills` | stale-reference search and marketplace version alignment |
| Marketplace install metadata | `marketplace` | `npm run check` in the marketplace repo |
| Ecosystem release health | `planr-pipeline` | `npm run doctor -- --strict` |

## Change Order

1. Change the owner repo first.
2. Add or update a check in the owner repo.
3. Mirror references in downstream repos.
4. Run `npm run doctor -- --strict` from `planr-pipeline`.
5. Release in the order documented in `docs/release-checklist.md`.

## Current Protocol Decision

`planr-pipeline/schemas/v1.0.0/` remains the canonical schema source for this
cleanup cycle. A dedicated protocol package can be created later, but only after
the existing drift checks are stable and green across all four repos.
