---
name: planr-dashboard
description: Start or inspect the loopback-only OpenPlanr planning dashboard. Use when the user wants to view local planning or Operate state in the browser.
license: MIT
---

# Planr Dashboard

Start or inspect the local OpenPlanr dashboard as a deterministic utility. Prefer
the packaged dashboard helper when present; otherwise use `planr dashboard` from
the optional utility CLI. Do not route dashboard startup through a semantic or
model subprocess.

Validate the project, bind only to loopback, reuse an already compatible server,
and choose another available port when the requested port is occupied by an
unrelated process. Open a browser only when requested.

Return the exact local URL, project root, port, and whether the server was
started or reused. On failure, report the actual bind or asset problem and the
shortest repair without inventing a URL.
