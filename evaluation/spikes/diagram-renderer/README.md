# Diagram renderer spike

This spike selects the production renderer for SPEC-005. It is an executable
decision record, not a second rendering implementation.

## Decision

OpenPlanr renders its semantic IR to deterministic clean SVG, loads the packaged
Inter 400 TTF, and rasterizes with `@resvg/resvg-js@2.6.2`. The active platform
payload stays below 15 MiB and the runtime needs no browser, CDN, downloaded
font, global command, or sibling checkout.

The MPL-2.0 resvg license is intentionally recorded rather than described as
MIT. OpenPlanr does not modify or copy resvg source into its MIT files. Package
and font notices remain part of dependency distribution.

Sharp/libvips fails the payload target. Mermaid CLI and Playwright remain
development controls because their browser requirement violates production
offline custody. The official Mermaid-to-Excalidraw package was evaluated but
is not installed; the first production editability ceiling is the native
flowchart scene projection only.

## Reproduce

Run the spike with the primary development runtime:

```sh
node evaluation/spikes/diagram-renderer/runner.mjs
```

Compatibility runs use already-installed runtimes:

```sh
fnm exec --using=20.20.2 node evaluation/spikes/diagram-renderer/runner.mjs
fnm exec --using=22.23.2 node evaluation/spikes/diagram-renderer/runner.mjs
```

The runner fails its `passed` field if cold render exceeds 2 seconds, the
39-fixture gallery exceeds 15 seconds, active runtime payload exceeds 15 MiB,
three structural digests differ, or any guarded `fetch` occurs.

The checked-in `results.json` records the latest Node 26 primary run, Node 20/22
macOS compatibility runs, and network-disabled Node 20/22 Linux ARM64-musl
packed-tarball runs. Each platform produced one stable cross-version flowchart
digest; raster bytes are not claimed identical across operating systems.

Linux ARM64-musl is executed from the packed `planr-pipeline` tarball in the
official Node 20 and Node 22 Alpine images with container networking disabled.
The selected dependency also declares GNU and musl x64/arm64 optional packages;
the public packed-install gate remains responsible for executing the installed
package on other release hosts.
