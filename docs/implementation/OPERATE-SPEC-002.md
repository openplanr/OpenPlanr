# OPERATE-SPEC-002 — OpenPlanr behavioral implementation

Status: implementation  
Umbrella spec: `SPEC-002-openplanr-operating-board`  
Ecosystem operation: `OPERATE-SPEC-002`  
Source version: `1.13.3`  
Target version: `1.14.0` (Changesets minor)

## Repository boundary

This repository owns:

- the public `planr operate` human and machine CLI;
- workspace and user-local state separation;
- canonical event, record, checkpoint, lock, journal, and recovery behavior;
- evidence collection, readiness, retention, redaction, and provider consent;
- advisor dispatch and deterministic consolidation;
- finding governance, route application/rollback, PLAN handoff, and causality;
- typed outcome evaluation, migrations, diagnostics, integrity, and security repair;
- setup, doctor, packed-install, and first-use developer experience.

Protocol v1.2 schemas, registries, reducers used for cross-runtime conformance,
dashboard projection contracts, and ecosystem saga primitives are consumed from
`planr-pipeline`. This repository does not write into sibling repositories.

## Required release evidence

- branch, commit, PR, approvals, and CI checks;
- `openplanr@1.14.0` npm version, tag, provenance, and tarball SHA-256;
- exact compatible `planr-pipeline@0.30.0`;
- packed clean-HOME test with only `planr` on `PATH`;
- deterministic demo and preview tests;
- real-runtime canaries where credentials are available.

Those facts are reconciled into the marketplace draft operation ledger. A
package.json version or draft ledger entry alone never marks this participant
verified.

## External action boundary

Implementation and release preparation do not authorize a commit, PR merge,
tag, npm publication, or deployment. Those actions are separately approved and
recorded by the ecosystem saga.
