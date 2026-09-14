# Operate Downstream Deletion Manifest

<!-- planr-product-workspace -->

This manifest is a read-only handoff. It grants no deletion authority and contains the same downstream path/classification pairs as the machine inventory.

| Repository | Path | Classification | Current authority | Required owner proof |
| --- | --- | --- | --- | --- |
| marketplace | package.json | DEFER_OWNER | read-only-inspection | owner-proof |
| marketplace | tests/operate-legacy-absence.test.mjs | DEFER_OWNER | read-only-inspection | owner-proof |
| OpenPlanr | CHANGELOG.md | DEFER_OWNER | read-only-inspection | owner-proof |
| OpenPlanr | input/tech/stack.md | DEFER_OWNER | read-only-inspection | owner-proof |
| OpenPlanr | package.json | DEFER_OWNER | read-only-inspection | owner-proof |
| OpenPlanr | scripts/verify-release-artifact.mjs | DEFER_OWNER | read-only-inspection | owner-proof |
| OpenPlanr | scripts/verify-release-journey.mjs | DEFER_OWNER | read-only-inspection | owner-proof |
| OpenPlanr | src/cli/commands/operate-v2.ts | DEFER_OWNER | read-only-inspection | owner-proof |
| OpenPlanr | src/cli/index.ts | DEFER_OWNER | read-only-inspection | owner-proof |
| OpenPlanr | src/services/operate-v2/client.ts | DEFER_OWNER | read-only-inspection | owner-proof |
| OpenPlanr | src/templates/rules/cursor/agents/db-agent.md | DEFER_OWNER | read-only-inspection | owner-proof |
| OpenPlanr | src/utils/package-version.ts | DEFER_OWNER | read-only-inspection | owner-proof |
| OpenPlanr | tests/integration/operate-v2-client.test.ts | DEFER_OWNER | read-only-inspection | owner-proof |
| OpenPlanr | tests/unit/migration-registry.test.ts | DEFER_OWNER | read-only-inspection | owner-proof |
| OpenPlanr | tests/unit/operate-legacy-absence.test.ts | DEFER_OWNER | read-only-inspection | owner-proof |
| skills | CHANGELOG.md | DEFER_OWNER | read-only-inspection | owner-proof |
| skills | package.json | DEFER_OWNER | read-only-inspection | owner-proof |
| skills | tests/operate-legacy-absence.test.mjs | DEFER_OWNER | read-only-inspection | owner-proof |

Every row remains `DEFER_OWNER` until its repository owner authorizes a separately verified change.
