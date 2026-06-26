# OpenPlanr Ecosystem Release Checklist

Use this checklist for coordinated releases that touch protocol, docs, routing,
or marketplace metadata.

## Release Order

1. `planr-pipeline`
2. `marketplace`
3. `skills`
4. `OpenPlanr`

Patch releases can skip repos that do not need a content change, but the final
audit must still verify all four repos: `planr-pipeline`, `marketplace`,
`skills`, and `OpenPlanr`.

## Before Opening PRs

Run in `planr-pipeline`:

```bash
npm run doctor
npm run doctor -- --strict
npm run doctor -- --json
npm run ecosystem:conformance
npm run ecosystem:conformance -- --strict
npm run test:docs
npm test
npm run conformance:check
git diff --check
```

Run in `marketplace` when marketplace metadata or README rows change:

```bash
npm run check
git diff --check
```

Run in `skills` when skill routing or version claims change:

```bash
rg -n "planr-pipeline|OpenPlanr|marketplace|schemas/v1.0.0|0\\.[0-9]+\\.[0-9]+|1\\.[0-9]+\\.[0-9]+"
git diff --check
```

Run in `OpenPlanr` when CLI output or protocol references change:

```bash
npm test
git diff --check
```

Do not stage local planning documents:

- `PROJECT_KNOWLEDGE.md`
- `FEATURE_MAP.md`
- `SYSTEM_ARCHITECTURE.md`
- `DEVEX_QUALITY_RISK_REGISTER.md`

## Tag And Release Audit

After merge and tag creation, run:

```bash
npm run doctor -- --release --strict
```

The release audit checks:

- `planr-pipeline` package, plugin manifest, stack metadata, protocol docs, and
  compatibility matrix agree.
- `marketplace` manifest and README agree.
- `skills` manifest has a version and the marketplace points to it.
- `OpenPlanr` has a package version and published release when checked.
- Git tags and GitHub releases exist for versioned repos.
- Cross-repo graph output matches through `npm run ecosystem:conformance -- --strict`.

## Rollback Notes

If a release is wrong, prefer a new patch release over retagging. Marketplace
metadata should point to the latest good released version. If a protocol doc is
wrong but schemas are correct, fix docs and ship a patch without changing the
protocol version.
