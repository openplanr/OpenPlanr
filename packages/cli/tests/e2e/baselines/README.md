# Dashboard visual baselines

The platform directories contain the active Playwright golden images and are intentionally tracked. Browser text rasterization differs by operating system, so each supported test platform has its own reviewed references.

- `darwin/` is the local macOS review reference.
- `linux/` is the canonical CI reference, taken from the actual images the browser workflow's `ubuntu-24.04` runner captures.

The screenshot helper selects `[process.platform, name]`; unscoped historical PNGs
are retained in Git history rather than this active baseline directory.

Update active snapshots only after reviewing the rendered UI. On macOS run `npm run test:browser --workspace=openplanr -- tests/e2e/dashboard-visual-regression.test.ts --update-snapshots=all`. For Linux, let the dashboard browser workflow fail on the changed comparisons, download its `dashboard-browser-diagnostics` artifact with `gh run download <run-id> -n dashboard-browser-diagnostics`, review each `*-actual.png`, and copy it to `linux/<name>.png`. Golden comparisons are soft, so one run records every changed image. Keep transient actual, diff, trace, and HTML report files in Playwright output directories; they are not source artifacts.
