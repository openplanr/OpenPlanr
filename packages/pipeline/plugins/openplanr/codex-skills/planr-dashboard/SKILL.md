---
name: planr-dashboard
description: Start or inspect the loopback-only OpenPlanr planning dashboard. Use when the user wants to view local planning or Operate state in the browser.
license: MIT
---

# Planr Dashboard

Run `planr pipeline dashboard` with the user's options. The command owns project
validation, port selection, loopback binding, server lifecycle, and reuse behavior;
do not reimplement those mechanics in the skill. Use `--no-watch` for a one-shot
view and `--open` only when requested.

Return the exact local URL and whether the server was started or reused. When the
command fails, report its problem and repair without inventing a URL.
