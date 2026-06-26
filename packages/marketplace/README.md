# OpenPlanr Marketplace

Official Claude Code plugin marketplace for [OpenPlanr](https://github.com/openplanr).

## Install

```
/plugin marketplace add openplanr/marketplace
```

Then install any of the plugins below:

```
/plugin install <plugin-name>@openplanr
```

## Plugins

| Plugin | Version | Description |
|---|---|---|
| [`planr-pipeline`](https://github.com/openplanr/planr-pipeline) | 0.24.9 | Spec-driven AI factory with specialized subagents, design generation/review, sync, dashboard, conformance checks, and tool-layer rule enforcement. Canonical Claude Code adapter for [OpenPlanr Protocol v1.0.0](https://github.com/openplanr/planr-pipeline/tree/main/docs/protocol); Cursor and Codex use generated OpenPlanr rules. |
| [`openplanr`](https://github.com/openplanr/skills) | 1.11.0 | OpenPlanr skill — multi-runtime routing playbook teaching Claude when to use the CLI, the pipeline plugin, generated Cursor/Codex rules, or bare `planr` commands. |

Versions in this README mirror `.claude-plugin/marketplace.json`; keep both in the same release-train change.

## Cross-runtime support

OpenPlanr is a runtime-agnostic protocol. The pipeline plugin above is the canonical Claude Code adapter; Cursor and Codex run the same workflow via planr-generated rule files:

```bash
# Cursor
npm i -g openplanr
planr rules generate --target cursor --scope pipeline

# Codex
planr rules generate --target codex --scope pipeline
```

Compatibility matrix: [`openplanr/planr-pipeline/docs/compatibility-matrix.md`](https://github.com/openplanr/planr-pipeline/blob/main/docs/compatibility-matrix.md). Protocol spec: [`openplanr/planr-pipeline/docs/protocol/`](https://github.com/openplanr/planr-pipeline/tree/main/docs/protocol).

## License

Each plugin in this marketplace ships under its own license. The marketplace metadata itself is MIT.
