---
name: planr-dashboard
description: Start or inspect the loopback-only OpenPlanr planning dashboard. Use when the user wants to view local planning or Operate state in the browser.
license: MIT
---

# OpenPlanr Dashboard

Start or inspect the local OpenPlanr dashboard as a deterministic utility. Prefer
the packaged dashboard helper when present; otherwise use `planr dashboard` from
the optional utility CLI. Do not route dashboard startup through a semantic or
model subprocess.

Validate the project, bind only to loopback, reuse an already compatible server,
and choose another available port when the requested port is occupied by an
unrelated process. Open a browser only when requested.

## Return

Lead with whether the dashboard was started, reused or blocked. Return a clickable
exact local URL, project root and port only when confirmed. State the startup or
health check actually performed; do not imply browser verification unless it ran.
On failure, retain the known service state and report the actual bind or asset
problem with the shortest repair, without inventing a URL. Omit unnecessary logs
and next steps; summary wording never requires another server launch.
