# OpenPlanr Marketplace

Official Claude Code plugin marketplace for [OpenPlanr](https://github.com/OpenPlanr).

## Install

```
/plugin marketplace add OpenPlanr/marketplace
```

Then install any of the plugins below:

```
/plugin install <plugin-name>@openplanr
```

## Plugins

| Plugin | Version | Description |
|---|---|---|
| [`planr-pipeline`](https://github.com/openplanr/planr-pipeline) | 0.12.0 | Spec-driven AI factory with 9 subagents and tool-layer rule enforcement. Canonical Claude Code adapter for [OpenPlanr Protocol v1.0.0](https://github.com/openplanr/planr-pipeline/tree/main/docs/protocol); same workflow runs on Cursor + Codex via `planr rules generate --scope pipeline`. |
| [`openplanr`](https://github.com/openplanr/skills) | 1.6.0 | OpenPlanr skill — multi-runtime routing playbook teaching Claude when to use which surface (Path A: Claude Code, A2: Cursor, A3: Codex, B: skill-driven, C: bare CLI). |

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
