# OpenPlanr Ecosystem Release Checklist

Use this checklist only for a separately scheduled release. Ordinary local
development and verification do not publish packages or deploy services.

## Release Order

The source workspace is consolidated, while public packages and
`openplanr-web` keep independent release identities:

1. Verify the complete OpenPlanr workspace and pack both public packages.
2. Deploy a backward-compatible `openplanr-web` change when the external service changed.
3. Publish `planr-pipeline` when its packed artifact changed.
4. Publish `openplanr` when its packed artifact changed.
5. Update generated host-distribution metadata in the OpenPlanr repository.

Enable v2-only room creation only after compatible clients are available.

Patch releases can skip unchanged artifacts. The final audit still reports
whether the independent `openplanr-web` checkout was present and healthy.

## Before Opening PRs

Run from the OpenPlanr workspace root:

```bash
npm ci
npm run generate
npm run check:generated
npm run check:boundaries
npm run test:focused
npm run build
npm run lint
npm run verify:packed:strict
planr doctor --strict --json
git diff --check
```

Run in `openplanr-web` when hosted service or generated share bytes change:

```bash
npm test
npm run share:check
npm run build
git diff --check
```

Keep the generated adapters, root marketplace manifest, `ecosystem.json`, and
both packed public artifacts on the same verified workspace revision.

Do not stage local planning documents:

- `PROJECT_KNOWLEDGE.md`
- `FEATURE_MAP.md`
- `SYSTEM_ARCHITECTURE.md`
- `DEVEX_QUALITY_RISK_REGISTER.md`

## Tag And Release Audit

After merge and tag creation, run the release audit from the pipeline workspace:

```bash
npm run doctor --workspace=planr-pipeline -- --release --strict
```

The release audit checks:

- `planr-pipeline` package, plugin manifest, stack metadata, protocol docs, and
  compatibility matrix agree.
- `openplanr-web` retains its independent package identity and required build,
  test, and hosted-service drift checks.
- root marketplace metadata and `ecosystem.json` match the workspace packages and canonical skills.
- `openplanr` and `planr-pipeline` keep their independent public versions.
- `CHANGELOG.md` carries a `## [<version>]` section for the version being
  released. A tag and a published release are not evidence that a version was
  documented — v0.37.0, v0.37.1, and v0.37.2 were tagged and published while the
  changelog jumped straight from 0.38.0 to 0.36.1.
- Git tags and GitHub releases exist for versioned repos.
- workspace conformance and packed-install checks pass without sibling checkouts.

## Rollback Notes

If a release is wrong, prefer a new patch release over retagging. Marketplace
metadata should point to the latest good released version. If a protocol doc is
wrong but schemas are correct, fix docs and ship a patch without changing the
protocol version.
