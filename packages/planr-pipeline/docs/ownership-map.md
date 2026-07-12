# OpenPlanr Ecosystem Ownership Map

This map keeps the four OpenPlanr repos from drifting. When a behavior changes,
the owning repo changes first; downstream repos mirror the contract only after
the owner is updated and checked.

## Repos

| Repo | Owns | Mirrors |
|---|---|---|
| `openplanr/OpenPlanr` | Dedicated planning, setup, runtime lifecycle, routing, locks, migration, rollback, unified doctor | Protocol and adapter contracts |
| `openplanr/planr-pipeline` | Complete PO–Design–DEV engine, schemas, role/adapter registries, conformance, boards, native Claude adapter | CLI handoff behavior |
| `openplanr/skills` | Reusable planning and delivery workflows | Current CLI and pipeline surfaces |
| `openplanr/marketplace` | Claude metadata and resolved `ecosystem.json` | Released component and adapter versions |

## Canonical Contracts

| Contract | Owner | Required check |
|---|---|---|
| Protocol schemas | `planr-pipeline` | `npm run test:schema` and `npm run conformance:check` |
| Adapter and role registries | `planr-pipeline` | v1.1 schema tests and portable-asset scan |
| Runtime lock and migration | `OpenPlanr` | setup/idempotency/rollback tests |
| Provenance event schema | `planr-pipeline` | schema validation in both planning engines |
| `.pipeline-shipped` marker | `planr-pipeline` | schema tests plus markdown contract tests |
| Graph JSON schema | `planr-pipeline` | graph schema tests and cross-repo conformance |
| CLI graph output | `OpenPlanr` | CLI tests against the graph schema |
| Skill routing language | `skills` | stale-reference search and marketplace version alignment |
| Marketplace metadata and compatibility manifest | `marketplace` | `npm run generate && npm run check` |
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
