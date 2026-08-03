# Real-runtime Operate canary fixtures (FR15)

The version/`operate inspect` canary could not have caught the failure that
shipped: it never ran a cycle. These fixtures and their driver make the release
canary run real Operate cycles against the exact release commits, on every
supported OS/Node, and assert on-disk durability — including the one scenario
that actually broke production: **a single lens stalling while four completed
analyses are lost.**

Everything here is consumed by `.github/workflows/operating-canary.yml`, after
`Validate generated runtime skill` and before `Build immutable canary evidence
report`. Every step writes a `real-runtime-*.log` into the same `evidence/`
directory the workflow already uploads.

## What is real vs. what is scripted

The shipped defect lived in the **orchestration** — the pre-driver fan-out
deadlocked (`Promise.all` never resolved) on a hung lens — not in any advisor's
language output. So these scenarios drive the **real** fan-out driver, the real
lease/heartbeat, the real filesystem projection, the real Chair consolidation,
and the real persisted report. Only the advisor **content** is scripted (a lens
returns a fixed cited-quiet/proposal payload, or, for the stalled lens, a
process that never returns). Scripting content is exactly the isolation that lets
the canary reproduce the deadlock deterministically and unattended.

A fixed-quiet advisor response is a synthetic fixture; per FR15 it is a
regression guard, **not** real-native-agent acceptance. The full cycle driven by
a real Claude Code / Codex / Cursor subagent needs runtime credentials and the
published packed artifact, so it is defined here and wired into the workflow as
an **owner-gated** matrix rather than substituted with a synthetic pass.

## Scenario matrix

`scenarios.json` is the machine-readable form. Summary:

| # | Scenario | Asserts | Runs unattended today |
|---|----------|---------|-----------------------|
| 1 | Complete cycle to the review gate | cycle reaches `reviewable`, a report is printed AND persisted, five roles present incl. Chair | yes (scripted advisors) |
| 2 | **Stalled role** | one lens stalls past its bounded budget → terminal `not_evaluated` with a governed reason; the other four lenses' results are durably recorded on disk; the lease is renewed by the heartbeat; the cycle still reaches Chair and a persisted report | **yes** |
| 3 | Terminate-and-resume | a resumed cycle never re-dispatches an already-recorded role and completes with all roles present | yes |
| 4 | Large monorepo + gitignored `.planr/` | a real cycle runs inside a large monorepo whose `.planr/` is gitignored (`git check-ignore .planr` succeeds) and never staged | yes |
| 5 | Transport hiding | the human transcript carries no lease token, stdin JSON payload, evidence digest, or harness/adapter command name outside the explicit `--json` evidence log | yes |
| 6 | No cross-runtime asset | the run produces no process or asset for a runtime other than the one the cycle is sticky to | yes |
| 7 | Only `planr` on PATH | the packed CLI drives `operate` with nothing but `planr` on PATH | yes (existing packed-cli step) |
| 8 | Parallel native subagents / same-runtime sequential fallback | a runtime that supports native parallel dispatch fans out in parallel; one that does not falls back to same-runtime sequential — no cross-runtime fallback | owner-gated (native agents) |
| 9 | Full real-native-agent cycle per runtime | a complete Operate cycle through the review gate driven by a real Claude Code, Codex, and Cursor subagent | owner-gated (credentials + published artifact) |

Scenarios 1-6 are exercised by `run-real-runtime-canary.mjs` driving the real
`runOperatingCycle` in-process against the large-monorepo fixture with the
stalled-role advisor script, and corroborated by the release-commit run of the
OpenPlanr real-orchestration suites the workflow invokes alongside it. Scenarios
8-9 are owner-gated: the workflow exposes a `live_advisor_dispatch` input and,
when it is not set, records an honest owner-gated evidence log naming the exact
command to run them.

## Files

- `scenarios.json` — the scenario matrix above, machine-readable.
- `stalled-role/advisor-script.json` — the scripted board: which lens stalls,
  and the cited-proposal payloads the healthy lenses return.
- `large-monorepo/` — the seed of a large monorepo whose `.planr/` is gitignored;
  `materialize-monorepo.mjs` expands it into a temp project of a configurable
  size for a run.
- `run-real-runtime-canary.mjs` — the driver. Imports the built OpenPlanr
  orchestration (`config`, `engine`, `event-store`, `reports`) exactly as the
  OpenPlanr `operate-lifecycle-chair-wiring` integration suite does, runs the
  scenarios against the materialized monorepo, and writes
  `evidence/real-runtime-canary.log`.
