---
description: Launch the local planr dashboard — a live, read-only view of the .planr/ graph (Overview · Graph · Board · List · Sprints · Activity). Reuses a running server if one already owns the port.
argument-hint: "[--port N] [--open] [--no-watch] [--view graph|board|list]"
---

# /planr-pipeline:dashboard

Starts (or reuses) a **persistent localhost HTTP server** that serves the planr
dashboard for the current project. The server is **independent of the agent**
(hard rule 14): once `DASHBOARD_URL:` is printed the command STOPS — the server
keeps running in the background and the agent does not block on it. The dashboard
is **read-only** (no write-back to `.planr/`).

This command is **additive and standalone**. It NEVER runs the PO phase or the
DEV phase, and it never auto-chains. It only resolves mode, negotiates a port,
starts/reuses the server, prints the URL, and exits.

---

## Flags

| Flag | Meaning | Default |
|------|---------|---------|
| `--port N` | Bind to TCP port `N` on `127.0.0.1`. | env `DASHBOARD_PORT`, else `7473` |
| `--open` | After printing the URL, open it in the default browser. | off |
| `--no-watch` | Do not start the `.planr/` file watcher (serve a static snapshot). | watcher on |
| `--view graph\|board\|list` | Append `?view=<value>` to the printed URL so it opens on that view. | server default |

Unknown flags are a fatal error (see `procedures/fatal-error-format.md`).

---

## Port resolution

`--port N` > env `DASHBOARD_PORT` > default `7473`. Resolution lives in
`procedures/dashboard-preflight.md`.

---

## Step sequence (mandatory order)

1. **Preflight** — run `procedures/dashboard-preflight.md`. It:
   - validates the working directory (a `.planr/` directory must exist),
   - resolves mode via `procedures/mode-detection.md` (spec-driven vs default —
     both are first-class; the dashboard reads whichever is present),
   - resolves the port (flag > `DASHBOARD_PORT` > `7473`),
   - performs **reuse-if-running** detection: if `<planrHome>/dashboard-daemon/<port>`
     names a live process AND `GET http://127.0.0.1:<port>/health` answers `{ ok: true }`,
     reuse that server (do not start a second one),
   - otherwise starts `lib/dashboard/server.mjs` (honouring `--no-watch`).
2. **Start / reuse server** — bind `lib/dashboard/server.mjs` on the resolved port
   (or confirm the reused one). The server registers `GET /api/graph`,
   `GET /api/node/:id`, `GET /api/events` (SSE), and static serving from
   `lib/dashboard/app/`.
3. **Print the URL** — emit exactly one line:
   ```
   DASHBOARD_URL: http://localhost:<port>/
   ```
   When `--view` is supplied, append `?view=<value>` to that URL.
4. **(optional) Open** — if `--open`, open the printed URL in the default browser.
5. **STOP.** The command is complete the moment `DASHBOARD_URL:` is printed. Do
   not block, do not tail logs, do not run any further phase. The server keeps
   serving in the background until the operator stops it.

---

## Termination rule

You are done ONLY when `DASHBOARD_URL:` has been printed (and, if `--open` was
given, the browser launch was attempted). A successful server bind is a step, not
completion. If any step fails, abort via `procedures/fatal-error-format.md` (two
lines) — never print a fake `DASHBOARD_URL:`.

This command does **not** reference, invoke, or chain to the PO phase or the DEV
phase under any circumstance.
