# Dashboard visual baselines

The platform directories contain the active Playwright golden images and are intentionally tracked. Browser text rasterization differs by operating system, so each supported test platform has its own reviewed references.

- `darwin/` is the local macOS review reference.
- `linux/` is the canonical CI reference generated with the Playwright image pinned by the browser workflow.

The screenshot helper selects `[process.platform, name]`; unscoped historical PNGs
are retained in Git history rather than this active baseline directory.

Update active snapshots only after reviewing the rendered UI. Use `npm run test:browser --workspace=openplanr -- --update-snapshots=all` on macOS and the pinned Playwright container for Linux. Keep transient actual, diff, trace, and HTML report files in Playwright output directories; they are not source artifacts.
