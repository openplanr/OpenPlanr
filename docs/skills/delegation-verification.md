# Delegation preview verification

Verified on 30 September 2026 in an isolated branch based on current OpenPlanr
main. This is an opt-in preview; package publication remains a maintainer action.
See [the user guide](delegation.md) for compatibility and limits.

## Automated evidence

- 93 delegate tests passed, covering required/optional context, secret handling,
  planning links, private custody, pinned helpers and rebuild recovery, exact
  sessions, bounded execution, integration rollback, repeat close, final report
  recovery and older records.
- 133 Protocol tests passed. All 14 focused regression gates passed, including
  native diagram sharing, design review, host routing and workspace boundaries.
- 40 focused backlog/CLI tests passed. The full workspace build, source lint,
  documentation/comment checks and 52 declaration exports passed.
- All 14 generators passed with no drift. Host parity covered 28 skills and nine
  Claude agents; runtime purity found no provider dependency or semantic
  subprocess in host-native workflows.
- Strict packed-workspace verification passed. Deterministic release packaging
  checked 31 products, 28 skills and nine Claude agents. The OpenAI plugin content
  check passed, and installed Claude/Codex delegate resources loaded independently
  of the source checkout. Stdin ESM imports of both helper entrypoints are covered.

One existing design browser journey timed out during an earlier concurrent suite
run. Its isolated rerun and the complete focused-suite rerun passed. No design
source was changed to address the timeout.

## Observed local-model recovery journey

The installed Codex skill ran against a loaded Qwen3.8 Flash Next model on a
disclosed local endpoint in a disposable six-file repository. The helper preflight
reported the capsule within its conservative bound against the observed 262,144
token context capacity. This did not certify inference quality or token accuracy.

The delegate authored the utility and tests inside the two declared scope paths.
Its first handoff hit the six-minute absolute deadline without a terminal result;
the runner blocked it and retained the worktree and observed session. Independent
review passed 11 tests and 27 assertions, with four preserved files byte-identical.

An explicit correction resumed that same session to add a frozen-input regression.
It completed in 45 seconds with an observed final result. All 12 tests, 27
independent assertions and four Preserve checks passed. The orchestrator reviewed
and integrated only the two observed paths into the disposable repository. Status
recovered the five-field final report, and repeated integrated close returned the
same report. The delegate's worktree remains retained separately from cleanup.

Integration first rejected a fixture permission mismatch: the private harness
created the two source files with `0600` permissions, while their Git baseline
recorded `0644`. The fixture's source permissions were restored to their committed
modes after checking unchanged baseline bytes; review and apply then passed
normally. No delegate source or test bytes were edited by the orchestrator.

This journey demonstrates bounded failure and exact-session recovery for the
tested configuration. It does not establish that all local models or tasks work,
that context is automatically compacted, or that a worktree is a security sandbox.
The timeout turn supplied no usable token usage; the correction turn's usage is
not a complete cost measurement for the journey.

## Preservation and release boundary

The original pilot's tracked/untracked files, staged patch and unstaged patch were
backed up and verified unchanged. Its existing integration edits and retained
runs were not imported or modified. Current main's native diagram implementation,
artifact sharing commands and canonical diagram/artifact skills were preserved.
Generated catalogs were regenerated from the combined canonical sources.

The helper has no public `planr delegate` command. Ordinary Ship remains
host-native, planning is report-only, and no helper run commits, creates a PR,
publishes or deploys. This change adds a patch changeset and prepares a separate
reviewable PR; merge, versioning, npm publication and production deployment are
separate release actions.
