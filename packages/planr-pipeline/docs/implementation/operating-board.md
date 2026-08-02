# Native work item: Operating Board Protocol v1.2

| Field | Value |
|---|---|
| Umbrella specification | `SPEC-002` |
| Ecosystem operation | `OPERATE-SPEC-002` |
| Repository | `openplanr/planr-pipeline` |
| Scope | Repository-local contract-owner work only |
| Target version | `planr-pipeline@0.30.0` |
| Status | Implemented locally; coded dashboard preview approved and integrated |

## Objective

Ship the portable Protocol v1.2 foundation for OpenPlanr's evidence-to-decision
operating loop without changing PLAN/SHIP behavior, Protocol v1.0 planning
artifacts, Protocol v1.1 readers, or the canonical nine delivery roles.

## Repository-owned deliverables

- Strict Protocol v1.2 schemas for operating configuration, cycles, evidence,
  readiness, advisor results, findings, decisions, data gaps, routes, events,
  immutable records, journals, projections, checkpoints, artifacts, migrations,
  recovery, SPEC links, typed outcomes, workspace manifests, provider manifests,
  ecosystem sagas, and ecosystem release operations.
- Separate six-lens operating registry and read-only provider registry.
- RFC 8785 JCS implementation and golden digest vectors.
- Deterministic event-chain verification, reducer, projections, checkpoints, and
  digest-bound route transitions. Checkpoints support default JCS hash
  integrity and optional externally injected signatures without storing keys.
- Structured repository provenance on evidence items plus auditable,
  credential-free provider policy, consent, retention, and budget manifests.
- Provider conformance kit.
- Portable, typed AGENT artifact generation with capability/budget binding,
  no-network/empty-tool sandbox policy, Markdown/HTML/JSON/CSV hardening,
  deterministic retries and provenance.
- Read-only dashboard projection reader and `/api/operate`.
- Approved coded dashboard preview based on the real Protocol fixture and its
  generated, read-only production dashboard integration.
- Registry-driven Claude/Codex/Cursor assets and generated docs with `--check`.
- Exact canonical Codex `$planr-operate` skill.

## Acceptance checks

```bash
npm run test:schema
npm run test:orchestration
npm run test:dashboard
npm run test:docs
npm run check:operating-assets
npm run conformance:operate
npm pack --dry-run
git diff --check
```

Additional release gates:

- Protocol v1.0 and v1.1 test suites remain green.
- `registry/roles.json` still contains exactly nine delivery roles.
- Every operating advisor has machine-evaluable minimum evidence.
- All launch providers are read-only and pass deterministic fixture
  conformance.
- Route acceptance cannot skip preparation or apply without matching proposal
  and confirmation digests.
- Applied reversible routes can produce a byte-exact rollback recovery record.
- Provider manifests contain no raw credentials; raw provider authentication
  remains machine-local.
- The checked-in dashboard projection equals reducer output byte-for-byte after
  canonical parsing.
- Codex skill hash matches the standalone skills repository.

## Rollback

Before npm publication, remove the additive v1.2 registrations/assets and
restore the package/registry version together; v1.0/v1.1 remain untouched.
After `planr-pipeline@0.30.0` is published, do not unpublish or retag. Mark the
ecosystem operation `forward-fix` and release a correcting patch. OpenPlanr must
keep `planr operate` unavailable until its compatibility manifest points to a
verified pipeline version.

## Downstream handoff

After pipeline CI and package publication:

1. OpenPlanr implements storage, commands, providers, routing, recovery, and
   outcome reconciliation against these exact contracts.
2. Skills mirrors the canonical Codex skill byte-for-byte.
3. Marketplace publishes the resolved compatibility manifest only after
   pipeline, CLI, and skills versions are verified.
