# Procedure: Dashboard preflight (port + mode + reuse-if-running)

> Read by `commands/dashboard.md` Step 1. Resolves the working directory, the
> mode, and the port; performs reuse-if-running detection; starts the server when
> needed; and prints `DASHBOARD_URL:`. Read-only with respect to `.planr/`
> artifacts — it never mutates plan/spec files.

## Inputs

- `$ARGUMENTS` — the flags from `commands/dashboard.md` (`--port N`, `--open`,
  `--no-watch`, `--view graph|board|list`).
- Project root (working directory).
- Environment: `DASHBOARD_PORT`, `PLANR_HOME` (overrides `~/.planr`).

## Step 1 — Validate the working directory

1. Confirm a `.planr/` directory exists at the project root. If absent, abort via
   `procedures/fatal-error-format.md`:
   ```
   No .planr/ directory found in the current project.
   Initialize planr first, then re-run /planr-pipeline:dashboard.
   ```
2. Do not require any spec/feature slug — the dashboard reads the whole project.

## Step 2 — Resolve mode

Run `procedures/mode-detection.md` (no slug). Bind `MODE = "spec-driven" |
"default"`. The dashboard reads whichever artifact tree is present; mode only
affects which readers the data engine (T-002) uses. Preflight does not fail when
one tree is empty — an empty project renders the dashboard's empty state.

## Step 3 — Resolve the port

Precedence (highest first):

1. `--port N` from `$ARGUMENTS` (must be an integer in `1..65535`; otherwise
   abort two-line).
2. Environment `DASHBOARD_PORT` (same validation).
3. Default `7473`.

Bind `PORT`.

## Step 4 — Reuse-if-running detection (FR7 / AC3)

Localhost only (`127.0.0.1`). A server is reusable when **both** hold:

1. **PID file:** `<planrHome>/dashboard-daemon/<PORT>` exists and names a live
   process — check with `readPidFile` + `isProcessAlive` from
   `lib/design-engine/daemon.mjs`.
2. **Health check:** `GET http://127.0.0.1:<PORT>/health` returns `200` with
   `{ ok: true }` (short timeout, e.g. 800ms).

Decision:

- **Both true → REUSE.** Do not start a second server. Skip to Step 6.
- **Otherwise → START.** A stale PID file (process gone, or port refuses) is
  treated as "not running" — proceed to start a fresh server (hard rule 14).

> Helpers `readPidFile`, `isProcessAlive`, `isPortInUse`, and `writePidFile` are
> the shared server-lifecycle exports of `lib/design-engine/daemon.mjs`; the
> dashboard server (`lib/dashboard/server.mjs`) imports `writePidFile` when it
> binds so the PID file always reflects the live process.

## Step 5 — Start the server (when not reusing)

1. Start `lib/dashboard/server.mjs` on `PORT`, bound to `127.0.0.1`.
   Programmatically: `createDashboardServer().listen(PORT)`. The CLI equivalent
   is `node lib/dashboard/server.mjs --serve <PORT>`.
2. Honour `--no-watch`: do **not** start the `.planr/` file watcher (the watcher
   is T-004's concern; the stub server starts no watcher regardless).
3. The server writes `<planrHome>/dashboard-daemon/<PORT>` (PID) and
   `<planrHome>/dashboard-daemon/port` (last bound port) for discovery.

## Step 6 — Print the URL and STOP (FR1 / AC1)

1. Emit exactly one line:
   ```
   DASHBOARD_URL: http://localhost:<PORT>/
   ```
   When `--view <value>` was supplied, print
   `DASHBOARD_URL: http://localhost:<PORT>/?view=<value>`.
2. If `--open` was supplied, attempt to open that URL in the default browser
   (best-effort; a failed open is a warning, not a fatal).
3. **STOP.** The command completes here. Do not block, do not tail the server, do
   not run any other phase. The server keeps serving in the background.

## Failure handling

Any fatal in Steps 1–5 aborts via `procedures/fatal-error-format.md` (two lines)
and must NOT print a `DASHBOARD_URL:` line. Never invent a URL for a server that
did not bind.
