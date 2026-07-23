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
| OpenPlanr CLI | 1.13.3 | pipeline ^0.29.2 |
| Pipeline package/plugin | 0.29.2 | CLI ^1.13.3 |
| Runtime skills | 1.15.0 | CLI ^1.13.3 |
| Protocol | 1.1.0 | reads v1.0 artifacts; v1.1 capabilities |
<!-- ecosystem-table:end -->

| Plugin | Version | Description |
|---|---|---|
| [`planr-pipeline`](https://github.com/openplanr/planr-pipeline) | 0.29.2 | Complete PO, Design, Review, DEV, and QA workflow with universal HTML artifact review and private sharing. |
| [`openplanr`](https://github.com/openplanr/skills) | 1.15.0 | Unified planning, artifact review, and delivery workflow skills for the certified runtimes. |

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

OpenPlanr CLI 1.13.2 and pipeline 0.29.0 provide a runtime-neutral review surface:

```bash
planr artifact ./artifact.html
planr artifact share ./artifact.html
planr artifact import "<returned-review-url>"
```

One generic artifact is an edge-to-edge `document` review by default. Its
minimal floating action rail exposes one-shot comments, the comments drawer,
and sharing without competing with the artifact itself.
Multi-variant and design-board workflows keep the zoomable `canvas` surface;
users can override either choice with `--presentation document|canvas`.
Complete local HTML/CSS/JavaScript is bundled into an invisible opaque-origin
sandbox. Review links are not standalone website deployments.

Sharing is never automatic. New generic shares create one stable AES-256-GCM
encrypted live room: anyone with the review URL can comment and see updates in
open tabs, while only the separate creator manage URL can pause comments, set
the final verdict, or delete the room. `--snapshot` keeps the explicit
fragment-only or encrypted-short-link alternative. Cloudflare stores ciphertext
only and the decryption key remains in the URL fragment at
`share.openplanr.dev`. Claude Code, Codex,
and Cursor all route artifact actions through the public `planr` command rather
than requiring the nested pipeline executable on `PATH`.

Compatibility matrix: [`openplanr/planr-pipeline/docs/compatibility-matrix.md`](https://github.com/openplanr/planr-pipeline/blob/main/docs/compatibility-matrix.md). Protocol spec: [`openplanr/planr-pipeline/docs/protocol/`](https://github.com/openplanr/planr-pipeline/tree/main/docs/protocol).

## License

Each plugin in this marketplace ships under its own license. The marketplace metadata itself is MIT.
