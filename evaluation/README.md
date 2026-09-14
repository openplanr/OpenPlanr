# Evaluation custody

OpenPlanr evaluation assets are catalogued here as a workspace concern. For `0.1.0`, the frozen professional-skill corpora, host profiles, budgets, baselines, and gate policy continue to be compiled into `packages/pipeline/evaluation/` so the public pipeline package remains self-contained. `catalog.json` classifies those compatibility assets and their canonical subject surfaces.

New evaluation suites should be registered in the root catalog first and projected into whichever public package must carry them. Evaluation and conformance code must never be imported by a runtime package.

`skills/authoring-cases.json` is the canonical local journey for the five
compiler-backed author commands and their repair diagnostics. It is consumed by
tests only; runtime packages do not import the evaluation catalog.

`skills/routing-corpus.json` covers all canonical skills with positive, negative,
ambiguous, alias, and collision language. `skills/resilience-journeys.json` covers
capability denial, host-native question fallback, headless behavior, interruption,
and recovery. The runtime accepts these documents as inputs; it never imports the
evaluation directory or treats fixtures as routing authority.

`npm run skill:evaluate:catalog` runs all composed projections plus the routing
and resilience suites. `npm run skill:impact` computes reverse dependency closure
before a shared source is edited; the version policy is documented in
`docs/skills/versioning-and-impact.md`.

Keep reusable evaluation inputs, such as `skills/design-workflow-scenarios.json`,
versioned. Local design evaluation outputs in `skills/design-workflow-evidence/`
and `skills/design-workflow-results.{json,md}` are ignored. Preserve these runs
locally for comparison; automated tests must create their own temporary fixtures
and must not require a contributor's retained evidence directory.
