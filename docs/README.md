# OpenPlanr documentation

## Use OpenPlanr

- [Getting started](getting-started.md): install, set up a host, initialize a project, write the first specification.
- [Skill catalog](generated/skills.md): every skill, when it is selected, and what it defers to.
- [CLI reference](../packages/cli/docs/CLI.md) and [troubleshooting](../packages/cli/docs/TROUBLESHOOTING.md).
- [Cross-runtime setup](../packages/cli/docs/CROSS_RUNTIME_SETUP.md): scopes, migration, rollback, offline use.
- [Diagrams](diagrams/authoring.md): author, render, and verify diagrams offline.
- [Support](../SUPPORT.md): where to ask and what to include.

## Contribute

- [Contributing](../CONTRIBUTING.md): the change workflow and verification gates.
- [Working from a checkout](contributing/dogfooding.md): build, install your own build into a host, troubleshoot.
- [Architecture](architecture/README.md): workspaces, dependency rules, generation graph.
- [Skill authoring](skills/authoring.md), [host runtime](skills/host-runtime.md), [host matrix](skills/host-matrix.md), [versioning and impact](skills/versioning-and-impact.md).
- [Releasing](RELEASING.md) and [maintainers](MAINTAINERS.md).

## Integrate

- [`@openplanr/protocol`](../packages/protocol/README.md): schemas, registries, and validation.
- [Diagram authoring contracts](diagrams/authoring-contracts.md): portable meaning, presentation, typed edits and compatibility.
- [Diagram edit kernel](diagrams/authoring-kernel.md): compile commands, preview atomic edits and undo without replacing newer work.
- [`planr-pipeline`](../packages/pipeline/README.md): the delivery pipeline package and its protocol documents.
- [Generated catalogs](generated/): skills, adapters, ecosystem, and the utility command catalog.
- [Verifying a release](PROVENANCE.md): how to check the signature, attestation, and bytes of a published version.
- [Brand assets](assets/brand/README.md): logo files and usage rules.

## Moved pages

| Previous location | Now |
| --- | --- |
| `docs/skills/installation.md`, `docs/skills/local-dogfooding.md`, `docs/skills/troubleshooting.md` | [Working from a checkout](contributing/dogfooding.md) |
| `docs/skills/release.md` | [Releasing](RELEASING.md) |
| `docs/migration/README.md` | [Architecture](architecture/README.md) |
| `docs/enterprise/company-workspaces.md` | [COMMERCIAL.md](../COMMERCIAL.md) |
| `packages/cli/docs/ARCHITECTURE.md` | [Architecture](architecture/README.md) |
| `packages/pipeline/docs/operate/*` | [Operate runtime protocol](../packages/pipeline/docs/protocol/operate-runtime-v2.md) |
