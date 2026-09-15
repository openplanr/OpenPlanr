# Contributing to the OpenPlanr CLI

The `openplanr` package is developed in the
[OpenPlanr monorepo](https://github.com/openplanr/OpenPlanr). Follow the
[root contribution guide](https://github.com/openplanr/OpenPlanr/blob/main/CONTRIBUTING.md)
and [Code of Conduct](https://github.com/openplanr/OpenPlanr/blob/main/CODE_OF_CONDUCT.md).

Clone the full repository and run these commands from its root:

```bash
npm ci
npm run generate
npm run build
npm run test:focused
```

Do not treat an installed npm package as a standalone development checkout.
CLI command registration lives under `packages/cli/src/cli/`; services and
package tests live under `packages/cli/src/services/` and `packages/cli/tests/`.
Canonical Protocol, domain, and skill sources live in their owning workspaces.
Edit those sources before regenerating their compatibility projections.

For a CLI change, run the relevant focused checks, then package tests and lint:

```bash
npm run test --workspace=openplanr
npm run lint --workspace=openplanr
```

The root guide describes command-catalog regeneration, full workspace checks,
and isolated packed-package verification. Submit a focused pull request with the
behavior change, regression coverage, and any limitations. Report vulnerabilities
using the [security policy](https://github.com/openplanr/OpenPlanr/blob/main/SECURITY.md).
