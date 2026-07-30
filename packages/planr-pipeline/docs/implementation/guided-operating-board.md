# OPERATE-SPEC-003 pipeline work item

Umbrella specification: `SPEC-003`
Release participant: `planr-pipeline@0.32.1`

This repository owns the additive guided interaction schemas, adapter capability
registry, transport-neutral answer reduction, generated runtime assets,
schema 1.1 self-describing answer submission, conformance journeys, and
deterministic canary. It does not own CLI questions,
answers, mutations, provider consent, or evidence classification.

Prepared verification:

```bash
npm test
npm run conformance:check
npm run test:guided-acceptance
npm run canary:guided-operate
npm pack --dry-run --json
```

Rollback before publication is repository-local. After `0.32.1` is public,
corrections use a forward-fix package release.
