# OpenPlanr Marketplace

Official Claude Code plugin marketplace for [OpenPlanr](https://github.com/openplanr).

## Claude marketplace install

```
/plugin marketplace add openplanr/marketplace
```

Then install any of the plugins below:

```
/plugin install <plugin-name>@openplanr
```

## Plugins

<!-- ecosystem-table:start -->
| Component | Version | Compatibility |
|---|---:|---|
| OpenPlanr CLI | 1.9.0 | pipeline ^0.25.1 |
| Pipeline package/plugin | 0.25.1 | CLI ^1.9.0 |
| Runtime skills | 1.12.0 | CLI ^1.9.0 |
| Protocol | 1.1.0 | reads v1.0 artifacts; v1.1 capabilities |
<!-- ecosystem-table:end -->

| Plugin | Version | Description |
|---|---|---|
| [`planr-pipeline`](https://github.com/openplanr/planr-pipeline) | 0.25.1 | Complete PO, Design, Review, DEV, and QA workflow; portable package with native Claude Code adapter. |
| [`openplanr`](https://github.com/openplanr/skills) | 1.12.0 | Unified planning and delivery workflow skills for the certified runtimes. |

Versions in this README mirror `.claude-plugin/marketplace.json`; keep both in the same release-train change.

## Cross-runtime support

OpenPlanr is the dedicated planning CLI and common runtime control plane. The
pipeline is the complete delivery workflow and includes feature-local planning.
Install and configure all detected certified runtimes through one surface:

```bash
curl -fsSL https://openplanr.dev/install.sh | sh
cd my-project
planr setup
planr doctor
```

The web installer installs only the CLI. Guided setup runs separately in an
interactive terminal, displays detected coding agents, and defaults to safe
user scope. Project scope requires a Git or initialized OpenPlanr project.

Compatibility matrix: [`openplanr/planr-pipeline/docs/compatibility-matrix.md`](https://github.com/openplanr/planr-pipeline/blob/main/docs/compatibility-matrix.md). Protocol spec: [`openplanr/planr-pipeline/docs/protocol/`](https://github.com/openplanr/planr-pipeline/tree/main/docs/protocol).

## License

Each plugin in this marketplace ships under its own license. The marketplace metadata itself is MIT.
