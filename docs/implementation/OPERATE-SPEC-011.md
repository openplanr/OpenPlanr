# OPERATE-SPEC-011 — Workflow convergence and setup honesty

Release participant: `openplanr@1.24.0`

Contract dependency: `planr-pipeline@0.40.0` / Protocol v1.4.0.

Umbrella spec: `SPEC-007`.

## Scope

`planr setup` becomes the single front door, and stops being quietly lossy. The
duplicated workflow surface converged behind one command set, and setup gained the
honesty properties a front door needs: it says what it skipped, it recovers from a
partial apply rather than leaving a half-configured project, and it remembers the
command-prefix choice instead of silently re-deciding it.

## Required behavior

- Setup reports every skipped runtime and why (not detected, minimal install,
  explicit opt-out) rather than omitting it from the summary.
- A partial apply is restored to its pre-setup state, and the restored files are
  named in the failure output.
- The persisted command-prefix choice (namespaced vs bare verbs) is honoured on
  re-run without re-prompting.

## Ledger

Recorded as `OPERATE-SPEC-011` in `openplanr/marketplace`.
