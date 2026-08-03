# OPERATE-SPEC-007 CLI work item

Umbrella specification: `SPEC-004`
Release participant: `openplanr@1.20.0`

This repository's contribution to the coordinated `OPERATE-SPEC-007` release of the
Operating Board is the harness pivot — the agent is the engine; the CLI harnesses,
verifies, and records. The unit of dispatch becomes a per-role operating mandate (the lens
question, declared read boundaries, a required response schema, and a citation
requirement) that carries no evidence bodies and no evidence index; evidence becomes an
output rather than an input, with citation resolution the universal fail-closed gate
(fabricated, wrong-range, moved-revision, and above-ceiling citations become governed gaps
on every path and every source, a zero-citation response records its role `not_evaluated`,
and a hard-blocked secret in cited content is rejected rather than redacted-and-accepted);
a gitignored `.planr/` tree is fully citable because the dispatched agent reads the
filesystem directly rather than `git ls-files` (the defect that starved three of six
lenses is gone by architecture); and the guided-init first-run livelock is resolved with a
revise path, a resumable-session recovery message, an advertised `--answers-file`
transport, and per-question renderability metadata. Completing the pivot in the same
coordinated release, sibling work retires the now-dead evidence collector — its walks and
budgets, role packs, mission packets, and the `pack|mission` dispatch-mode split — behind
the mandate contract; renders cycle integrity as a first-class surface in the readable
tree and a `doctor` check; makes the persisted `cycles/<id>/report.md` a self-contained
record with complete registers; corrects the "commit-safe root" claim to an honest,
redaction-based statement; collapses runtime classification to
mandate-capable-or-unsupported with no silent structured fallback; and deprecates the
CLI's own structured-provider advisor path and `--ai` planning surfaces on a
scheduled-removal path (functional this release, pointed at the harness flow, never
silently removed).

Full feature specification:
`.planr/specs/SPEC-004-operate-agent-harness-architecture/`. Depends on
`planr-pipeline@0.36.1` (the additive operating-mandate schema, the regenerated
mandate-flow command/skill instructions, the registry investigation mandates, and the
reclassified adapter capability rows this release dispatches against).

Before publication each participant may compensate locally; after an npm package is
public, recovery is forward-fix only.

## Coordinated release checklist (external actions)

Release order: `planr-pipeline@0.36.1` (precondition) → `openplanr@1.20.0` →
`@openplanr/skills 1.22.0` → marketplace (last). `protocol.current` stays `1.3.0` — there
is no protocol bump this release.

- [ ] `planr-pipeline@0.36.1` published, tag `v0.36.1` exists, and this repository's pins
      are finalized (the 0.36.1 patch is required because it removes retired v1.2
      workflow guidance from every generated adapter): verify
      `npm view planr-pipeline@0.36.1 version` → `0.36.1`;
      `.github/workflows/{ci,publish,release}.yml` each pin `ref: v0.36.1`; and both
      packed-install e2e assertions require
      `optionalDependencies["planr-pipeline"] === "0.36.1"`
      (`tests/e2e/operate-packed-install.test.ts`,
      `tests/e2e/operate-guided-packed-install.test.ts`).
- [ ] `openplanr@1.20.0` published from this repository's own release flow
      (`npm run release`), with provenance and tarball SHA-256 recorded, and its release
      notes naming the FR4 deprecation (US-006) and the FR6 guided-init fixes (US-004).
- [ ] `@openplanr/skills 1.22.0` released from its own repository: re-copy the regenerated
      operate skill from the published `planr-pipeline@0.36.1` templates, bump the CI
      pipeline-fixture pin to `v0.36.1`, and declare `cliRange ^1.20.0`.
- [ ] Marketplace updated last, in one PR: `ecosystem.json` component versions/ranges
      (`cli ^1.20.0`, `pipeline ^0.36.1`, `skills 1.22.0`, `marketplace` bumped to its next
      version) with `protocol.current` held at `1.3.0`; the `operatingAdvisorDispatch`
      adapter capability rows reflecting the mandate-capable/unsupported reclassification;
      the `.claude-plugin/marketplace.json` plugin pins (`planr-pipeline 0.36.1`,
      `openplanr 1.20.0`); a new `SPEC-007` entry in `validate-operation.mjs`'s
      `repoLocalWorkItems` plus the marketplace's own
      `docs/implementation/OPERATE-SPEC-007.md` (the two-step stage/finalize ledger for
      `OPERATE-SPEC-007`); the FR4 deprecation notice in the ecosystem record; and a
      `releaseOperation` ledger entry for `OPERATE-SPEC-007` recording real branches,
      commits, PRs, tags, and integrity hashes.
