# Unified dashboard migration

> SPEC-020 atomic cutover — legacy standalone dashboard retirement

## What changed

The loopback dashboard server (`lib/dashboard/server.mjs`) now serves the unified
OpenPlanr React build from `dist/dashboard`. The legacy direct-DOM client under
`lib/dashboard/app/` has been removed from the pipeline package.

| Surface | Before | After |
|---------|--------|-------|
| Product UI | `lib/dashboard/app/*` standalone modules | `OpenPlanr/dist/dashboard` React build |
| Default static root | Packaged legacy `app/` tree | Resolved unified build via `resolve-packaged-dashboard-root.mjs` |
| Operate CLI | Already passed `dist/dashboard` | Also passes `dashboardBuildId` from `dashboard-manifest.json` |
| Server/API | Unchanged | Unchanged — graph, bootstrap, Operate transport remain in pipeline |

## Supported upgrade path

1. Build or install OpenPlanr with a current dashboard manifest.
2. Start the dashboard through `planr operate dashboard` or any caller that passes
   `staticRoot` + `dashboardBuildId` from the installed product build.
3. Verify `GET /api/bootstrap` returns `compatibility.status = "compatible"` and a
   `ui.buildId` that matches `dashboard-manifest.json`.

## Unsupported / fail-closed pairs

| Pair | Result |
|------|--------|
| Unified server + legacy `app/` assets | Build/install fails absence scan; bootstrap reports incompatible manifest |
| Mixed manifest kind (`legacy-dashboard-build`) | Bootstrap stays fail-closed (`DASHBOARD_MANIFEST_INVALID`) |
| Missing `dist/dashboard` at server start | `resolvePackagedDashboardRoot()` throws before bind |
| Mismatched `dashboardBuildId` option vs manifest | Server refuses to advertise a false build id |

## Rollback

Rollback is package-level only:

1. Reinstall the previous OpenPlanr release whose `dist/dashboard` you trust.
2. Reinstall the matching `planr-pipeline` release if server contracts changed.
3. Restart the loopback dashboard process.

No durable project migration runs during cutover. `.planr/` data, Operate
records, and Planning ledgers are untouched.

The rollback test exercises the complete local sequence against one disposable
project: start the known unified build, reject an unsupported advertised build,
then return to the known build. It hashes the complete `.planr/` tree before,
during, and after that sequence and requires byte-for-byte equality. Because the
Operate 2.0 dashboard is unpublished, this is a compatibility/rollback proof,
not a claim that a public historical package pair has been migrated.

## Resolution order

`lib/dashboard/resolve-packaged-dashboard-root.mjs` resolves the static root in
this order:

1. `OPENPLANR_DASHBOARD_ROOT` — explicit absolute `dist/dashboard` override
2. `openplanr/dist/dashboard` — installed consumer package when present
   (`package.json` exports `./dashboard` manifest and `./package.json` for
   `require.resolve`)

The resolver never inspects a sibling source checkout. Local cross-repository
QA packs both products and installs their tarballs into a disposable consumer;
development callers may instead pass the explicit absolute override.

## Verification

```bash
# Pipeline absence + conformance
node conformance/verify-unified-dashboard-absence.mjs
npm run conformance:dashboard

# OpenPlanr product proof
cd ../OpenPlanr
npm run build
npx vitest run tests/e2e/dashboard-cutover.test.ts
npx vitest run tests/e2e/dashboard-upgrade-downgrade.test.ts
```
