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
| OpenPlanr CLI | 1.10.0 | pipeline ^0.26.3 |
| Pipeline package/plugin | 0.26.3 | CLI ^1.10.0 |
| Runtime skills | 1.13.0 | CLI ^1.10.0 |
| Protocol | 1.1.0 | reads v1.0 artifacts; v1.1 capabilities |
<!-- ecosystem-table:end -->

| Plugin | Version | Description |
|---|---|---|
| [`planr-pipeline`](https://github.com/openplanr/planr-pipeline) | 0.26.3 | Complete PO, Design, Review, DEV, and QA workflow with universal HTML artifact review and private sharing. |
| [`openplanr`](https://github.com/openplanr/skills) | 1.13.0 | Unified planning, artifact review, and delivery workflow skills for the certified runtimes. |

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

## Artifact review and private sharing

OpenPlanr CLI 1.10.0 and pipeline 0.26.3 add a runtime-neutral review surface:

```bash
planr artifact ./artifact.html
planr artifact share ./artifact.html
planr artifact import "<returned-review-url>"
```

Small reviews are encoded into a `share.openplanr.dev` URL fragment and never
reach the server. Large reviews use opt-in, expiring AES-256-GCM short links;
Cloudflare stores ciphertext only and the decryption key remains in the URL
fragment. Sharing is never automatic. Claude Code, Codex, and Cursor all route
artifact actions through the public `planr` command rather than requiring the
nested pipeline executable on `PATH`.

Compatibility matrix: [`openplanr/planr-pipeline/docs/compatibility-matrix.md`](https://github.com/openplanr/planr-pipeline/blob/main/docs/compatibility-matrix.md). Protocol spec: [`openplanr/planr-pipeline/docs/protocol/`](https://github.com/openplanr/planr-pipeline/tree/main/docs/protocol).

## License

Each plugin in this marketplace ships under its own license. The marketplace metadata itself is MIT.
