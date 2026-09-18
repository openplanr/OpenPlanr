<p align="center">
  <img alt="OpenPlanr" width="72" src="https://raw.githubusercontent.com/openplanr/OpenPlanr/main/docs/assets/brand/openplanr-mark.svg">
</p>

<h1 align="center">planr-pipeline</h1>

<p align="center">
  The OpenPlanr delivery pipeline: PO, design, review, implementation, QA, and delivery outputs,<br>
  plus self-contained projections of the OpenPlanr Protocol, Operate runtime, artifact review, and design contracts.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/planr-pipeline"><img alt="npm version" src="https://img.shields.io/npm/v/planr-pipeline?style=flat-square&labelColor=08080C&color=237A72&label=planr-pipeline"></a>
  <a href="https://github.com/openplanr/OpenPlanr/actions/workflows/ci.yml"><img alt="Workspace CI" src="https://img.shields.io/github/actions/workflow/status/openplanr/OpenPlanr/ci.yml?branch=main&style=flat-square&labelColor=08080C&color=237A72&label=CI"></a>
  <a href="https://nodejs.org"><img alt="Node.js 20 or later" src="https://img.shields.io/node/v/planr-pipeline?style=flat-square&labelColor=08080C&color=237A72"></a>
  <a href="https://github.com/openplanr/OpenPlanr/blob/main/LICENSE"><img alt="MIT license" src="https://img.shields.io/badge/license-MIT-237A72?style=flat-square&labelColor=08080C"></a>
</p>

## Who installs this

Most people do not install `planr-pipeline` directly. The
[`openplanr`](https://www.npmjs.com/package/openplanr) CLI depends on the exact matching
version and installs it with `planr setup`; the skills that run in Claude Code, Codex, and
Cursor call into it for deterministic work. Install it yourself when you integrate with the
Protocol, the Operate runtime, or the dashboard contracts from your own code:

```bash
npm install planr-pipeline
```

Requires Node.js 20 or later. The package never calls a model; reasoning stays in the
coding agent. Its four runtime dependencies cover hashing, HTML parsing, compression,
and bundling; the optional ones add PNG rasterization and the diagram font.

## What it contains

| Area | Entry points | Purpose |
| --- | --- | --- |
| Protocol | `planr-pipeline/protocol`, `planr-pipeline/schemas/*`, `planr-pipeline/registry/*` | Spec, story, task, design, QA, and provenance contracts; command and role registries; JSON Schemas from 1.0.0 to 2.0.0 |
| Pipeline | `planr-pipeline`, `planr-pipeline/professional-skills` | Feature-local PO planning, stack conventions, nine role definitions, verification discovery, and the shipped-marker proof |
| Operate runtime | `planr-pipeline/operate/*-v2` | Durable operating cycles: assignments, authorization, policy, approvals, governed execution and recovery, evidence, projections, scheduling |
| Dashboard contracts | `planr-pipeline/dashboard/*` | Verified JSON readers and display contracts for the local planning and Operate dashboard |
| Assets | `stacks/`, `templates/`, `references/`, `procedures/`, `gallery/`, `fixtures/`, `conformance/` | Stack conventions, output templates, diagram grammar references, procedures, and conformance fixtures |

Every export is listed in `package.json`; the [Protocol documentation](docs/protocol/README.md)
describes the contracts and their versions.

## How it relates to the skills

The skills you invoke in a coding agent (`spec`, `plan`, `ship`, `design`, `diagram`,
`operate`, and the rest) are shipped by the `openplanr` package and reason inside the
agent. This package holds the portable contracts and deterministic engine they rely on,
so a specification written on one host is read identically on another. The
[skill catalog](https://github.com/openplanr/OpenPlanr/blob/main/docs/generated/skills.md)
lists every skill.

## Documentation

- [Protocol](docs/protocol/README.md): spec artifacts, agent roles, commands, runtime adapters, guided interactions, Operate runtime 2.0
- [Rules](docs/rules.md) and the [compatibility matrix](docs/compatibility-matrix.md)
- [Spec](https://github.com/openplanr/OpenPlanr/blob/main/packages/pipeline/docs/spec-anatomy.md), [story](https://github.com/openplanr/OpenPlanr/blob/main/packages/pipeline/docs/us-anatomy.md), and [task](https://github.com/openplanr/OpenPlanr/blob/main/packages/pipeline/docs/task-anatomy.md) anatomy, and the [pipeline overview](https://github.com/openplanr/OpenPlanr/blob/main/packages/pipeline/docs/pipeline-overview.md)
- [Artifact review](docs/artifact-review.md), [design loop](https://github.com/openplanr/OpenPlanr/blob/main/packages/pipeline/docs/design-loop.md), [design review](https://github.com/openplanr/OpenPlanr/blob/main/packages/pipeline/docs/design-review.md), [dashboard](https://github.com/openplanr/OpenPlanr/blob/main/packages/pipeline/docs/dashboard.md)
- [Doctor](docs/doctor.md) and the [ecosystem guide](docs/ecosystem-guide.md)
- Maintainer references: [ownership map](docs/ownership-map.md), [release checklist](docs/release-checklist.md), [release ledger](docs/release-ledger.md), [skill evaluation](docs/skill-evaluation.md)

Project-level documentation, getting started, and support live in the
[OpenPlanr repository](https://github.com/openplanr/OpenPlanr/blob/main/docs/README.md).

## Versioning

Pre-1.0 semantic versioning: minor versions may change behavior, patch versions are
fixes and documentation. Package versions are independent of the Protocol schema and
document versions they ship. The `openplanr` CLI pins the exact `planr-pipeline` version
it was released with.

## License

[MIT](LICENSE). Diagram renderer notices are listed in
[THIRD_PARTY-DIAGRAM-NOTICES.md](THIRD_PARTY-DIAGRAM-NOTICES.md). The OpenPlanr name and
logo are covered by the [trademark policy](https://github.com/openplanr/OpenPlanr/blob/main/TRADEMARKS.md).
