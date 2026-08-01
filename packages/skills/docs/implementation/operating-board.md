# Operating Board downstream work item

- **Operation:** `OPERATE-SPEC-002`
- **Umbrella specification:** `openplanr/planr-pipeline` —
  `.planr/specs/SPEC-002-openplanr-operating-board/SPEC-002-openplanr-operating-board.md`
- **Repository:** `openplanr/skills`
- **Target:** `@openplanr/skills` 1.22.0

## Repository-only scope

- Add the thin `planr-operate` workflow and register it with the standalone
  skill marketplace.
- Present only CLI-returned questionnaires and typed actions, construct typed
  answer envelopes from the questionnaire's `submission` contract through
  resumable sessions, and continue an explicitly
  requested cycle through its bounded native advisor lifecycle without manual
  command handoffs.
- Route citation failures only through the current governed recovery handoff;
  never trial-edit project configuration, infer scanner exclusions, or restore
  retired collector/classification controls.
- Route exclusively through the public `planr operate` CLI. Preserve separate
  provider, acceptance, apply, planning, PLAN review, SHIP, and external-effect
  boundaries.
- Present the brief and CEO/CTO/CPO/CMO/COO/Chair Markdown or JSON reports with
  the CLI's exact governed conversion actions. The dashboard remains optional.
- Return exactly the Protocol v1.3 citation-bearing advisor response required by
  each immutable mandate. Never synthesize canonical result-wrapper metadata or
  digests in a runtime adapter.
- Update unified guidance, README inventory, release metadata, and changelog.
- Validate portable naming, command boundaries, runtime-neutral content, and
  byte parity with the pipeline-generated Codex skill when that read-only
  workspace input is present.

This work item may read the umbrella contract and canonical generated asset. It
must not write `planr-pipeline`, `OpenPlanr`, `marketplace`, or any other sibling
repository.

## Verification

```bash
npm test
```

Validation must reject runtime vendor/model leakage, direct `planr-pipeline`
execution, non-operate command routing, copied questions/defaults, implicit
authority, missing safety boundaries, metadata/version drift, and canonical
generated-skill drift.

## Rollback boundary

Before release, revert this repository’s `OPERATE-SPEC-002` changes. After a
skills tag is published, issue a forward patch that removes the skill from the
marketplace list and restores prior guidance; do not mutate operating project
state or roll back another repository from this work item.
