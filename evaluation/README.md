# Evaluation inputs

This directory contains the inputs consumed by the current skill tests and
commands. Evaluation and conformance code must never be imported by a runtime
package.

- `skills/authoring-cases.json` drives the compiler-backed authoring command tests
  and repair diagnostics.
- `skills/routing-corpus.json` covers positive, negative, ambiguous, alias, and
  collision language. `skills/resilience-journeys.json` covers capability denial,
  host-native question fallback, interruption, and recovery.
- `skills/migrations/` contains the frozen byte comparisons consumed by the
  markdown compiler's compatibility tests.
- `spikes/diagram-renderer/` retains a runnable renderer benchmark and its recorded
  decision. Its README explains the manual entry point and measured limits.

`npm run skill:evaluate:catalog` runs the composed projections plus routing and
resilience checks. `npm run skill:impact` computes affected consumers before a
shared source is edited; see [versioning and impact](../docs/skills/versioning-and-impact.md).

Manual developer tools remain available even when they are not CI gates:
`skill:evaluate:model` explicitly runs a local Codex model evaluation,
`skill:package:check` checks previously generated release archives, and
`skill:benchmark` measures the generated release with optional budget enforcement.
These commands read their documented current inputs; old captured reports are
available through Git history. Model evaluation requires the selected host and
model to be available and is separate from deterministic verification.

Local design evidence under `skills/design-workflow-evidence/` and
`skills/design-workflow-results.{json,md}` stays ignored. Automated tests create
their own temporary fixtures and do not require a contributor's saved runs.
