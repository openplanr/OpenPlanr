---
'openplanr': minor
'planr-pipeline': patch
---

You can now work on a local design from the CLI with `openplanr design`:

- `inspect`, `validate` and `render` check and render a design document.
- `open` starts the local design studio, and `studio status` and `studio stop` report or stop it from another terminal, including a studio a design skill started.
- `view-context`, `export`, `verify` and `handoff` report what the studio shows, export standalone HTML, record a browser check and read the review handoff.
- `fonts fetch` downloads open-license fonts into the design.
- `capabilities --json` reports which design command contract your install serves.

These commands need the optional `planr-pipeline` package. Without it, `openplanr design capabilities` still succeeds and reports `E_DESIGN_RUNTIME_MISSING`, and the other commands stop with that code. Reinstall with `npm install -g openplanr`, without `--omit=optional`.

`openplanr artifact open` on a design gives the same reinstall step when that package is missing.
